## What RunMate checks before a run

| Situation | What RunMate does |
|-----------|-------------------|
| The project uses pnpm, Yarn or Bun | uses it, no setup needed |
| The script belongs to a project in a subfolder | runs it from that folder |
| The project asks for another Node.js version | switches to it for this run |
| That Node.js version is not installed | asks, then installs it |
| Dependencies are not installed yet | installs them first |
| The port of the dev server is taken | says which program holds it and offers to stop it |
| The script fails | turns its button red and offers **Run again** |

RunMate never installs or stops anything without asking you first.

Every one of these can be turned off in the settings.
