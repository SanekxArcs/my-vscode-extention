## A chain: several commands, one click

Say you saved two commands, `Build` and `Deploy`.

1. Open the list and choose **Add new chain** at the bottom.
2. Type a name, for example `Build and deploy`.
3. Pick `Build`, then pick `Deploy`, then choose **Done**.

Now `Build and deploy` runs `Build`, waits until it ends, and then runs `Deploy`.

- If `Build` fails, `Deploy` does **not** run. TerminalMate tells you which step stopped the chain.
- Every question (`${input:...}`) is asked before the first step starts, so you can walk away.

Stopping at a failed step needs VS Code 1.93 or newer. On older versions all steps are simply sent to the terminal.

## A key for a command

1. Open the list, click the pencil on a row, choose **Keyboard shortcut**.
2. A ready line is copied for you and the shortcuts file opens.
3. Paste it and change `"key"` to the key you want:

```json
{ "key": "ctrl+alt+d", "command": "terminal-mate.run", "args": "Build and deploy" }
```

`args` is the name of the saved command or chain.
