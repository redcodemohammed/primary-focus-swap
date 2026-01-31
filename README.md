# Primary Focus Swap

**Primary Focus Swap** is a GNOME Shell extension designed to keep your active workflow centered.

It automatically brings your focused window to the **Primary Monitor**. If that monitor is already occupied, it swaps the existing window to the monitor where the focus came from. This ensures your active task is always directly in front of you, regardless of how you switched to it (Alt+Tab, Super+`, or Mouse).

## How It Works

The logic is simple but effective, especially for multi-monitor setups (2, 3, or more displays).

**The Scenario:**

- **Monitor 1 (Primary):** Hosting _Window A_ (Browser)
- **Monitor 2:** Hosting _Window B_ (Terminal)
- **Monitor 3:** Hosting _Window C_ (Slack)

**The Action:**

1. You are currently focused on _Window A_ (Monitor 1).
2. You press `Alt+Tab` to switch focus to _Window B_ (Monitor 2).

**The Result:**

- **Monitor 1:** Now displays _Window B_ (Focused).
- **Monitor 2:** Now displays _Window A_ (Swapped).
- **Monitor 3:** Remains untouched.

## Compatibility Note

### GNOME Version

- Supports GNOME 45, 46, and 47 (ESM architecture).

### Pop Shell / Tiling Window Managers

**Status:** Experimental

This extension relies on standard GNOME window management calls (`move_to_monitor`). Tiling extensions like **Pop Shell** maintain their own strict internal binary trees for window positions.

- **Potential conflict:** Pop Shell might fight the move, causing windows to snap back or overlap.
- **Recommendation:** If you experience visual glitches, disable the "Tile Windows" feature in Pop Shell while using this extension.

## Installation

### Option 1: Manual Installation (For Developers)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/primary-focus-swap.git
   ```

2. **Copy to the extensions directory:**

   ```bash
   # Create the directory if it doesn't exist
   mkdir -p ~/.local/share/gnome-shell/extensions/primary-focus-swap@yourusername.github.com

   # Copy files
   cp -r primary-focus-swap/* ~/.local/share/gnome-shell/extensions/primary-focus-swap@yourusername.github.com/
   ```

3. **Restart GNOME Shell:**

   - **X11:** Press <kbd>Alt</kbd> + <kbd>F2</kbd>, type `r`, and hit <kbd>Enter</kbd>.
   - **Wayland:** Log out and log back in.

4. **Enable the extension:**
   ```bash
   gnome-extensions enable primary-focus-swap@yourusername.github.com
   ```

### Option 2: GNOME Extensions Website

(Coming soon — once published)

## Configuration (Planned Features)

- **Toggle behavior:** Choose between "Swap" (exchange places) or "Push" (just move focused window).
- **Monitor selector:** Manually define which monitor is considered "Primary" for this extension.
- **App blacklist:** Prevent specific apps (e.g., video players, OBS) from moving.

## Contributing

Contributions, issues, and feature requests are welcome.

1. Fork the project.
2. Create your feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m "Add some AmazingFeature"`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Open a pull request.

## License

Distributed under the GNU General Public License v3.0. See LICENSE for more information.
