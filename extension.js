import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class PrimaryFocusSwap extends Extension {
    enable() {
        this._focusHandlerId = global.display.connect(
            'notify::focus-window',
            this._onFocusChange.bind(this)
        );
        this._isSwapping = false;
    }

    disable() {
        if (this._focusHandlerId) {
            global.display.disconnect(this._focusHandlerId);
            this._focusHandlerId = null;
        }
    }

    _onFocusChange() {
        // 1. Safety Lock: Prevent recursion if we are currently moving windows
        if (this._isSwapping) return;

        const focusedWindow = global.display.focus_window;
        
        // 2. Filter invalid windows (desktop, null, etc.)
        if (!focusedWindow || focusedWindow.get_window_type() === Meta.WindowType.DESKTOP) {
            return;
        }

        const primaryIndex = global.display.get_primary_monitor();
        const currentIndex = focusedWindow.get_monitor();

        // 3. Only act if focused window is NOT on primary monitor
        if (currentIndex === primaryIndex) {
            return;
        }

        // 4. Identify the "victim" window currently on the primary monitor.
        // We get the window list, filter for primary monitor, and pick the top one.
        // Note: The 'focusedWindow' is technically the top one globally, but we look for the top one residing on primary.
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
        const residentWindow = windows.find(w => 
            w.get_monitor() === primaryIndex && 
            !w.is_minimized() && 
            w.get_window_type() !== Meta.WindowType.DESKTOP
        );

        this._swapWindows(focusedWindow, residentWindow, currentIndex, primaryIndex);
    }

    _swapWindows(incomingWindow, outgoingWindow, incomingMonitorIndex, primaryMonitorIndex) {
        this._isSwapping = true;
        
        try {
            // Move the new focus to Primary
            incomingWindow.move_to_monitor(primaryMonitorIndex);

            // If there was a window on primary, send it to the secondary monitor
            if (outgoingWindow) {
                outgoingWindow.move_to_monitor(incomingMonitorIndex);
            }
            
            // Re-assert focus to ensure the user doesn't lose it during the move
            incomingWindow.activate(global.get_current_time());
            
        } catch (e) {
            console.error(`[Primary Focus Swap] Error swapping windows: ${e}`);
        } finally {
            // Unlock immediately after execution
            this._isSwapping = false;
        }
    }
}