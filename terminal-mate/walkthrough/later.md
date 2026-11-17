## Run it later, or again and again

Click the clock on a row. TerminalMate asks **When should it run?** Type one of these:

| You type | What happens |
|----------|--------------|
| `10m` | runs once, in 10 minutes |
| `1h30m` | runs once, in an hour and a half |
| `14:30` | runs once, at the next 14:30 |
| `every 15m` | runs every 15 minutes |
| `daily 09:00` | runs every day at 09:00 |

The status bar shows the next run with a countdown. Click it to run a schedule now or to cancel it.

Good to know:

- Schedules run only while VS Code is open, in the project where you made them.
- A scheduled command gets its own terminal. It never types into the terminal you are working in.
- Questions (`${input:...}`) are asked when you make the schedule, not when it runs.
- If VS Code was closed at the planned time, a one-time command is offered to you when you open the project again.
