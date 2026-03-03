# Open in New Tab

![Status Page](https://img.shields.io/badge/status-all%20systems%20probably%20fine-fff?style=flat&logo=statuspage&logoColor=FFFFFF&label=status&labelColor=5B595C&color=AB9DF2) ![All Your Base](https://img.shields.io/badge/all%20your%20base-are%20belong%20to%20us-fff?style=flat&logo=retroarch&label=all%20your%20base&labelColor=5B595C&color=5C7CFA) ![GIF Quality](https://img.shields.io/badge/gif%20quality-potato%20certified-fff?style=flat&logo=giphy&logoColor=FFFFFF&label=gif%20quality&labelColor=5B595C&color=FFD866) ![Frog Mode](https://img.shields.io/badge/frog%20mode-ribbit-fff?style=flat&logo=duolingo&logoColor=FFFFFF&label=frog%20mode&labelColor=5B595C&color=5C7CFA) ![VHS Tracking](https://img.shields.io/badge/vhs%20tracking-adjusting-fff?style=flat&logo=youtube&logoColor=FFFFFF&label=VHS%20tracking&labelColor=5B595C&color=78DCE8) ![Debugging](https://img.shields.io/badge/debugging-print%20statements-fff?style=flat&logo=gnometerminal&logoColor=FFFFFF&label=debugging&labelColor=5B595C&color=78DCE8) ![Jira](https://img.shields.io/badge/jira-947%20open%20tickets-fff?style=flat&logo=jira&logoColor=FFFFFF&label=jira&labelColor=5B595C&color=5C7CFA) ![Days Since Incident](https://img.shields.io/badge/days%20since%20incident-0-fff?style=flat&logo=fireship&logoColor=FFFFFF&label=days%20since%20incident&labelColor=5B595C&color=A9DC76) ![Typing](https://img.shields.io/badge/typing-three%20dots%20forever-fff?style=flat&logo=whatsapp&logoColor=FFFFFF&label=typing&labelColor=5B595C&color=5C7CFA)

<p align="center">
  <img src="assets/header.svg" width="600" />
</p

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
