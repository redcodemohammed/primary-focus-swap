import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

export default class PrimaryFocusSwap extends Extension {
  enable() {
    this._settings = this.getSettings()
    this._settingsChangedId = this._settings.connect('changed', () => this._loadSettings())

    this._focusHandlerId = global.display.connect('notify::focus-window', this._onFocusChange.bind(this))
    this._restackedHandlerId = global.display.connect('restacked', this._onFocusChange.bind(this))
    this._isSwapping = false
    this._focusSerial = 0
    this._retryTimeoutIds = new Set()

    this._loadSettings()
  }

  disable() {
    if (this._idleId) {
      GLib.source_remove(this._idleId)
      this._idleId = null
    }

    if (this._retryTimeoutIds) {
      for (const id of this._retryTimeoutIds) GLib.source_remove(id)
      this._retryTimeoutIds.clear()
    }

    if (this._focusHandlerId) {
      global.display.disconnect(this._focusHandlerId)
      this._focusHandlerId = null
    }
    if (this._restackedHandlerId) {
      global.display.disconnect(this._restackedHandlerId)
      this._restackedHandlerId = null
    }

    if (this._settingsChangedId) {
      this._settings?.disconnect(this._settingsChangedId)
      this._settingsChangedId = null
    }
    this._settings = null
  }

  _loadSettings() {
    // Defaults match schema; keep safe fallbacks.
    const s = this._settings
    if (!s) {
      this._swapMode = 'swap'
      this._targetMonitorMode = 'primary'
      this._fixedTargetMonitor = 0
      this._settleDelayMs = 150
      this._retryCount = 2
      this._retryDelayMs = 120
      this._scopeMode = 'focused-workspace'
      this._ignoreFullscreen = true
      this._appBlocklist = []
      return
    }

    this._swapMode = s.get_string('swap-mode') || 'swap'
    this._targetMonitorMode = s.get_string('target-monitor-mode') || 'primary'
    this._fixedTargetMonitor = s.get_int('fixed-target-monitor')
    this._settleDelayMs = s.get_uint('settle-delay-ms')
    this._retryCount = s.get_uint('retry-count')
    this._retryDelayMs = s.get_uint('retry-delay-ms')
    this._scopeMode = s.get_string('scope-mode') || 'focused-workspace'
    this._ignoreFullscreen = s.get_boolean('ignore-fullscreen')

    const rawBlock = s.get_strv('app-blocklist')
    this._appBlocklist = (rawBlock || []).map((x) => (x ?? '').toString().trim().toLowerCase()).filter(Boolean)
  }

  _getTargetMonitorIndex() {
    if (this._targetMonitorMode === 'fixed') {
      const idx = this._fixedTargetMonitor
      const n = global.display.get_n_monitors?.() ?? null
      if (Number.isInteger(idx) && idx >= 0 && (n == null || idx < n)) return idx
    }
    return global.display.get_primary_monitor()
  }

  _isFullscreenWindow(win) {
    if (!win) return false
    if (typeof win.is_fullscreen === 'function') return win.is_fullscreen()
    if (typeof win.get_fullscreen === 'function') return win.get_fullscreen()
    if (typeof win.fullscreen === 'boolean') return win.fullscreen
    return false
  }

  _getWindowAppIdentifiers(win) {
    const ids = []

    try {
      const app = Shell.WindowTracker.get_default()?.get_window_app?.(win)
      const id = app?.get_id?.()
      if (id) ids.push(id)
    } catch (_) {
      // ignore
    }

    try {
      const wmClass = win.get_wm_class?.()
      if (wmClass) ids.push(wmClass)
    } catch (_) {
      // ignore
    }

    try {
      const wmClassInstance = win.get_wm_class_instance?.()
      if (wmClassInstance) ids.push(wmClassInstance)
    } catch (_) {
      // ignore
    }

    return ids.map((x) => x.toString().trim().toLowerCase()).filter(Boolean)
  }

  _isBlockedWindow(win) {
    if (!win) return true
    if (!this._appBlocklist?.length) return false
    const ids = this._getWindowAppIdentifiers(win)
    return ids.some((id) => this._appBlocklist.includes(id))
  }

  _getCandidateWindowsForResident(focusedWindow) {
    if (!focusedWindow) return []

    // Helper to de-dupe while preserving order.
    const addUnique = (dst, src) => {
      const seen = new Set(dst)
      for (const w of src) {
        if (!seen.has(w)) {
          dst.push(w)
          seen.add(w)
        }
      }
    }

    const windowsOut = []
    const wsManager = global.workspace_manager

    if (this._scopeMode === 'all-workspaces') {
      const activeWs = wsManager.get_active_workspace()
      addUnique(windowsOut, global.display.get_tab_list(Meta.TabList.NORMAL, activeWs))

      const count = wsManager.get_n_workspaces?.() ?? 0
      for (let i = 0; i < count; i++) {
        const ws = wsManager.get_workspace_by_index?.(i)
        if (!ws || ws === activeWs) continue
        addUnique(windowsOut, global.display.get_tab_list(Meta.TabList.NORMAL, ws))
      }

      return windowsOut
    }

    const workspace =
      this._scopeMode === 'active-workspace'
        ? wsManager.get_active_workspace()
        : (focusedWindow.get_workspace?.() ?? wsManager.get_active_workspace())

    return global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
  }

  _onFocusChange() {
    // 1. Safety Lock: Prevent recursion if we are currently moving windows
    if (this._isSwapping) return

    // Sequence number to ignore stale scheduled callbacks
    this._focusSerial++
    const serial = this._focusSerial

    // Cancel any pending idle callback to avoid stale processing
    if (this._idleId) {
      GLib.source_remove(this._idleId)
      this._idleId = null
    }

    // Defer processing to let window/workspace state fully settle (important for Alt+Tab)
    // Some setups (tiling extensions) may also race move_to_monitor; we handle that with retries.
    const delayMs = Number.isFinite(this._settleDelayMs) ? this._settleDelayMs : 150
    this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
      this._idleId = null
      if (serial !== this._focusSerial) return GLib.SOURCE_REMOVE
      this._processFocusChange()
      return GLib.SOURCE_REMOVE
    })
  }

  _processFocusChange() {
    if (this._isSwapping) return

    const focusedWindow = global.display.focus_window

    // 2. Filter invalid windows (desktop, null, etc.)
    if (!focusedWindow || focusedWindow.get_window_type() === Meta.WindowType.DESKTOP) {
      return
    }

    if (this._ignoreFullscreen && this._isFullscreenWindow(focusedWindow)) {
      return
    }

    if (this._isBlockedWindow(focusedWindow)) {
      return
    }

    const targetIndex = this._getTargetMonitorIndex()
    const currentIndex = focusedWindow.get_monitor()

    // 3. Only act if focused window is NOT on primary monitor
    if (currentIndex === targetIndex) {
      return
    }

    let residentWindow = null
    if (this._swapMode !== 'push') {
      const windows = this._getCandidateWindowsForResident(focusedWindow)
      residentWindow =
        windows.find(
          (w) =>
            w.get_monitor() === targetIndex &&
            w !== focusedWindow &&
            !this._isMinimizedWindow(w) &&
            w.get_window_type() !== Meta.WindowType.DESKTOP &&
            !(this._ignoreFullscreen && this._isFullscreenWindow(w)) &&
            !this._isBlockedWindow(w)
        ) ?? null
    }

    this._swapWindowsWithRetry(focusedWindow, residentWindow, currentIndex, targetIndex)
  }

  _swapWindowsWithRetry(incomingWindow, outgoingWindow, incomingMonitorIndex, targetMonitorIndex) {
    const attemptSwap = (attempt) => {
      // If focus changed since we scheduled this, stop.
      if (global.display.focus_window !== incomingWindow) return

      // Already on primary? Done.
      if (incomingWindow.get_monitor() === targetMonitorIndex) return

      this._swapWindows(incomingWindow, outgoingWindow, incomingMonitorIndex, targetMonitorIndex)

      // Verify and retry a couple times to handle races (e.g. tiling/window management extensions).
      const maxRetries = Number.isFinite(this._retryCount) ? this._retryCount : 2
      if (attempt >= maxRetries) return

      const retryDelay = Number.isFinite(this._retryDelayMs) ? this._retryDelayMs : 120
      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, retryDelay, () => {
        this._retryTimeoutIds?.delete(id)
        attemptSwap(attempt + 1)
        return GLib.SOURCE_REMOVE
      })

      this._retryTimeoutIds?.add(id)
    }

    attemptSwap(0)
  }

  _isMinimizedWindow(win) {
    if (!win) return true

    // Mutter API varies by GNOME version/bindings.
    if (typeof win.is_minimized === 'function') return win.is_minimized()
    if (typeof win.get_minimized === 'function') return win.get_minimized()
    if (typeof win.minimized === 'boolean') return win.minimized

    return false
  }

  _swapWindows(incomingWindow, outgoingWindow, incomingMonitorIndex, targetMonitorIndex) {
    this._isSwapping = true

    try {
      // Move the new focus to target
      incomingWindow.move_to_monitor(targetMonitorIndex)

      // If there was a resident window and we're in swap mode, send it to the source monitor
      if (this._swapMode !== 'push' && outgoingWindow) {
        outgoingWindow.move_to_monitor(incomingMonitorIndex)
      }

      // Re-assert focus to ensure the user doesn't lose it during the move
      incomingWindow.activate(global.get_current_time())
    } catch (e) {
      console.error(`[Primary Focus Swap] Error swapping windows: ${e}`)
    } finally {
      // Unlock immediately after execution
      this._isSwapping = false
    }
  }
}
