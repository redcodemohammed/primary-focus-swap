import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/shell/extensions/prefs.js'

export default class PrimaryFocusSwapPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings()

    window.set_default_size(640, 520)

    const page = new Adw.PreferencesPage({
      title: 'Primary Focus Swap',
      icon_name: 'preferences-system'
    })
    window.add(page)

    const behaviorGroup = new Adw.PreferencesGroup({
      title: 'Behavior'
    })
    page.add(behaviorGroup)

    const swapModeRow = new Adw.ComboRow({
      title: 'When target monitor is occupied',
      subtitle: 'Swap windows or only move the focused window',
      model: new Gtk.StringList({ strings: ['Swap', 'Push'] })
    })
    behaviorGroup.add(swapModeRow)

    const swapModeToIndex = (v) => (v === 'push' ? 1 : 0)
    const swapModeFromIndex = (i) => (i === 1 ? 'push' : 'swap')

    swapModeRow.selected = swapModeToIndex(settings.get_string('swap-mode'))
    swapModeRow.connect('notify::selected', () => {
      settings.set_string('swap-mode', swapModeFromIndex(swapModeRow.selected))
    })

    const fullscreenRow = new Adw.SwitchRow({
      title: 'Ignore fullscreen windows',
      subtitle: 'Do not move focused fullscreen windows and do not displace fullscreen residents'
    })
    behaviorGroup.add(fullscreenRow)
    settings.bind('ignore-fullscreen', fullscreenRow, 'active', Gio.SettingsBindFlags.DEFAULT)

    const monitorGroup = new Adw.PreferencesGroup({
      title: 'Target Monitor'
    })
    page.add(monitorGroup)

    const targetModeRow = new Adw.ComboRow({
      title: 'Target monitor selection',
      subtitle: "Use GNOME's primary monitor or a fixed monitor index",
      model: new Gtk.StringList({ strings: ['Primary monitor', 'Fixed index'] })
    })
    monitorGroup.add(targetModeRow)

    const targetModeToIndex = (v) => (v === 'fixed' ? 1 : 0)
    const targetModeFromIndex = (i) => (i === 1 ? 'fixed' : 'primary')

    targetModeRow.selected = targetModeToIndex(settings.get_string('target-monitor-mode'))
    targetModeRow.connect('notify::selected', () => {
      settings.set_string('target-monitor-mode', targetModeFromIndex(targetModeRow.selected))
    })

    const fixedMonitorRow = new Adw.SpinRow({
      title: 'Fixed target monitor index',
      subtitle: 'Monitor indices can change after docking/reordering displays',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 15,
        step_increment: 1,
        page_increment: 1
      })
    })
    monitorGroup.add(fixedMonitorRow)
    settings.bind('fixed-target-monitor', fixedMonitorRow, 'value', Gio.SettingsBindFlags.DEFAULT)

    const timingGroup = new Adw.PreferencesGroup({
      title: 'Timing'
    })
    page.add(timingGroup)

    const settleDelayRow = new Adw.SpinRow({
      title: 'Settle delay (ms)',
      subtitle: 'Wait time after focus changes before moving windows',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 2000,
        step_increment: 10,
        page_increment: 50
      })
    })
    timingGroup.add(settleDelayRow)
    settings.bind('settle-delay-ms', settleDelayRow, 'value', Gio.SettingsBindFlags.DEFAULT)

    const retryCountRow = new Adw.SpinRow({
      title: 'Retry count',
      subtitle: 'Extra attempts to counter tiling/WM "snap back" behavior',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10,
        step_increment: 1,
        page_increment: 1
      })
    })
    timingGroup.add(retryCountRow)
    settings.bind('retry-count', retryCountRow, 'value', Gio.SettingsBindFlags.DEFAULT)

    const retryDelayRow = new Adw.SpinRow({
      title: 'Retry delay (ms)',
      subtitle: 'Time between retries',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 2000,
        step_increment: 10,
        page_increment: 50
      })
    })
    timingGroup.add(retryDelayRow)
    settings.bind('retry-delay-ms', retryDelayRow, 'value', Gio.SettingsBindFlags.DEFAULT)

    const advancedGroup = new Adw.PreferencesGroup({
      title: 'Advanced'
    })
    page.add(advancedGroup)

    const scopeRow = new Adw.ComboRow({
      title: 'Resident window scope',
      subtitle: 'Where to look for the window currently on the target monitor',
      model: new Gtk.StringList({ strings: ['Focused workspace', 'Active workspace', 'All workspaces'] })
    })
    advancedGroup.add(scopeRow)

    const scopeToIndex = (v) => {
      if (v === 'active-workspace') return 1
      if (v === 'all-workspaces') return 2
      return 0
    }
    const scopeFromIndex = (i) => {
      if (i === 1) return 'active-workspace'
      if (i === 2) return 'all-workspaces'
      return 'focused-workspace'
    }

    scopeRow.selected = scopeToIndex(settings.get_string('scope-mode'))
    scopeRow.connect('notify::selected', () => {
      settings.set_string('scope-mode', scopeFromIndex(scopeRow.selected))
    })

    const blocklistRow = new Adw.EntryRow({
      title: 'App blocklist',
      text: ''
    })
    blocklistRow.set_placeholder_text('Example: org.gnome.Terminal.desktop, obs, vlc')
    advancedGroup.add(blocklistRow)

    const refreshBlocklistEntry = () => {
      const values = settings.get_strv('app-blocklist')
      blocklistRow.text = (values || []).join(', ')
    }

    refreshBlocklistEntry()

    let updating = false
    blocklistRow.connect('notify::text', () => {
      if (updating) return
      updating = true
      try {
        const parts = blocklistRow.text
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
        settings.set_strv('app-blocklist', parts)
      } finally {
        updating = false
      }
    })

    settings.connect('changed::app-blocklist', () => {
      updating = true
      try {
        refreshBlocklistEntry()
      } finally {
        updating = false
      }
    })
  }
}
