## Blanks that are filled in when the command runs

Save this command:

```
git switch -c ${input:Branch name}
```

When you run it, TerminalMate asks **Branch name**. You type `feature/login`, and the terminal gets:

```
git switch -c 'feature/login'
```

| Write this | What happens when the command runs |
|------------|------------------------------------|
| `${input:Branch name}` | asks you to type a value |
| `${pick:Where\|staging\|production}` | lets you choose one from a list |
| `${clipboard}` | puts in the text you copied last |
| `${workspaceFolder}` | puts in the path of the open folder |
| `${env:HOME}` | puts in an environment variable |

Good to know:

- The same `${input:...}` twice in one command asks only once.
- Your answer is put in single quotes, so spaces in it are safe.
- Want to type in the middle of a command yourself? Put `<|>` there. TerminalMate types the command up to that point and waits. Click **Finish snippet** in the status bar when you are done.
