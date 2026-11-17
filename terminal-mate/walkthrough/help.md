## What TerminalMate does for you

| Situation | What TerminalMate does |
|-----------|------------------------|
| You run `git reset --hard`, `git clean -fd` or a force push | asks **Continue?** first |
| You want the command from a minute ago | **TerminalMate: History** lists the last ones, with your answers already filled in |
| You run the same command all day | the `Last: ...` button in the status bar runs it again with one click |
| A command only makes sense on Windows, macOS or Linux | it is shown only there (the `os` field) |
| You want the same commands on another computer | **TerminalMate: Export Commands** and **Import Commands** |
| Your team should have the same commands | turn on **Save Commands To Workspace** and commit `.vscode/settings.json` |

## All commands

Press `Ctrl+Shift+P` (on Mac `Cmd+Shift+P`) and type `TerminalMate`:

- Open Saved Commands
- Run Last Command
- History
- Schedule Command
- Scheduled Commands
- Import Commands / Export Commands
- Finish Snippet
- Open the Getting Started Guide

Everything can be changed in the settings: search for `terminal-mate`.
