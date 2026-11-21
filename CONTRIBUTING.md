# Contributing to Havi Hub

Thank you for taking the time to help. Issues and pull requests can be written in Spanish or English.

## Reporting a bug

Before opening an issue, please check that it has not been reported already. A useful report includes:

- the Havi Hub version (shown at the bottom of Settings) and how it was installed (installer, portable, AppImage or .deb);
- the operating system and its version;
- the steps that lead to the problem, what you expected and what happened instead;
- if the game is involved, a link to the profile's log: open the profile, go to Logs and press the up arrow ("Upload to mclo.gs and copy the link").

Do not paste passwords, account tokens or API keys in an issue, and check any log for personal information before sharing it.

Security problems must not be reported in public issues. See [SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue describing the problem the feature would solve and how you imagine it working. Features that only make sense for a single setup are less likely to be added, but the discussion is still welcome.

## Working on the code

Requirements: Node.js 22 or newer. To build the Windows installer, also Zig (`pip install ziglang`).

```sh
npm ci
npm start      # build and run
npm test       # unit tests
```

The project is organized as follows:

- `src/main`: the Electron main process (engine management, profiles, downloads, CurseForge and Modrinth clients).
- `src/renderer`: the interface, written in React.
- `src/shared`: code used by both.
- `tests`: unit tests, run with Node's built-in test runner.
- `scripts`: build, packaging and end-to-end test scripts.

Some guidelines:

- Keep each pull request focused on one change, and describe what it does and how it was tested.
- Follow the style of the surrounding code. Comments are written in English and explain why something is done, not only what.
- Interface text is written in Spanish inside `t('…')`. After adding or changing a string, run `node scripts/i18n/gen.mjs` and add the English translation to `src/renderer/lib/i18n-en.js`.
- Text the main process shows to the person (errors, the downloads panel) is written the same way, with `new UserError('…', { … })` and `tr('…', { … })` from `src/shared/usertext.js`, so the interface can translate it. Use `{name}` placeholders, not template literals.
- Add or update tests for behavior that can be tested without the game.
- Do not include images, sounds or other files from Minecraft or from other projects unless their license allows it. The app reads the game's own files from the player's computer instead.

## License

By contributing, you agree that your contributions are licensed under the [GNU General Public License v3.0](LICENSE), the same license as the rest of the project.
