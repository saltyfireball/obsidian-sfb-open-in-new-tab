# Open in New Tab

An Obsidian plugin that forces files to open in new tabs instead of replacing the current tab.

## Features

- **Universal coverage**: Works with Quick Switcher, command palette, bookmarks, search results, backlinks, graph view, sidebar clicks, and markdown links
- **Focus existing tab**: If a file is already open in another tab, focuses that tab instead of opening a duplicate
- **Same-file navigation**: Clicking heading/block links within the same file stays in the current tab
- **Modifier key support**: Ctrl/Cmd+click, Shift+click, and Alt+click behave as expected (split, window, etc.)
- **Toggleable**: Enable/disable via settings without restarting Obsidian

## How It Works

Monkey-patches `Workspace.getLeaf()` to intercept calls that would reuse the current tab (`getLeaf()` or `getLeaf(false)`) and forces them to open a new tab instead (`getLeaf('tab')`). Calls that already request a new tab, split, or window pass through unchanged.

Also patches `openLinkText()` to handle same-file heading navigation (stays in current tab) and already-open file detection (focuses existing tab).

## Install

1. Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/sfb-open-in-new-tab/` directory
2. Enable "Open in New Tab" in Obsidian Settings > Community Plugins

## Settings

- **Enable Open in New Tab**: Toggle the new-tab behavior on/off
- **Focus Existing Tab**: When enabled, if the target file is already open in another tab, focus that tab instead of opening a new one

## License

MIT
