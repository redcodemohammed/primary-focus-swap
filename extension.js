import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

export default class PrimaryFocusSwap extends Extension {
  enable() {
    this._focusHandlerId = global.display.connect('notify::focus-window', this._onFocusChange.bind(this))
    this._restackedHandlerId = global.display.connect('restacked', this._onFocusChange.bind(this))
    this._isSwapping = false
    this._focusSerial = 0
    this._retryTimeoutIds = new Set()
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
    this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
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

    const primaryIndex = global.display.get_primary_monitor()
    const currentIndex = focusedWindow.get_monitor()

    // 3. Only act if focused window is NOT on primary monitor
    if (currentIndex === primaryIndex) {
      return
    }

    // 4. Identify the "victim" window currently on the primary monitor.
    // Use the focused window's workspace (Alt+Tab can switch workspaces depending on settings).
    const workspace = focusedWindow.get_workspace?.() ?? global.workspace_manager.get_active_workspace()
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
    const residentWindow = windows.find(
      (w) =>
        w.get_monitor() === primaryIndex &&
        w !== focusedWindow &&
        !this._isMinimizedWindow(w) &&
        w.get_window_type() !== Meta.WindowType.DESKTOP
    )

    this._swapWindowsWithRetry(focusedWindow, residentWindow, currentIndex, primaryIndex)
  }

  _swapWindowsWithRetry(incomingWindow, outgoingWindow, incomingMonitorIndex, primaryMonitorIndex) {
    const attemptSwap = (attempt) => {
      // If focus changed since we scheduled this, stop.
      if (global.display.focus_window !== incomingWindow) return

      // Already on primary? Done.
      if (incomingWindow.get_monitor() === primaryMonitorIndex) return

      this._swapWindows(incomingWindow, outgoingWindow, incomingMonitorIndex, primaryMonitorIndex)

      // Verify and retry a couple times to handle races (e.g. tiling/window management extensions).
      if (attempt >= 2) return

      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
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

  _swapWindows(incomingWindow, outgoingWindow, incomingMonitorIndex, primaryMonitorIndex) {
    this._isSwapping = true

    try {
      // Move the new focus to Primary
      incomingWindow.move_to_monitor(primaryMonitorIndex)

      // If there was a window on primary, send it to the secondary monitor
      if (outgoingWindow) {
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
