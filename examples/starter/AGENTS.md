# This is a OneJS Play game

A small game that runs on [play.onejs.com](https://play.onejs.com) inside a
shared Unity WebGL container. The code is React and TypeScript against one
package, `oj`, and nothing else: no build configuration, no Unity project,
no `CS.*` interop. The site builds it when you publish.

## Files

| File | What it is |
|---|---|
| `index.tsx` | The entry. `mount(<Game />)` renders it; `useFrame` is the game loop. |
| `oj.json` | The manifest: name, stage size and fit, controls, tags. Applied when a commit is published. |
| `cover.html` | The card on the gallery. A whole document, rendered on the game's own origin, drawing only. |
| Anything else with a source extension | Built with the entry. `.tsx .ts .jsx .js .json .uss .css .txt .md .svg .html`. |
| `.png .jpg .mp3 .ogg .wav .mp4 .webm .woff2 .ttf` | Assets, served at `/assets/<path>` on the game's origin; read them with `assetUrl("name.png")`. |

Limits: 100 source files, 512 KB each, 2 MB together; 200 assets, 16 MB each,
64 MB together. Files that are neither (this one, `.gitignore`, a LICENSE) are
stored and never shipped, up to 64 KB each. `node_modules` is refused.

## The loop

```bash
git clone https://play.onejs.com/g/<sid>.git
# edit
git commit -am "What changed"
git push origin main
```

Pushing to `main` builds the commit on the server and, if it builds, makes it
what runs. The build result comes back as `remote:` lines; a compile error
names the file, line and column, the push still lands, and the previous
build stays live until the next commit that builds. Other branches and tags
are stored and never built. `draft` is the browser editor's working branch:
do not push to it.

Pushing wants a personal access token from https://play.onejs.com/manage,
sent as the password (the username is ignored). Cloning a public game needs
nothing. The same token is a bearer for the API.

## Reading the docs

Every page at https://play.onejs.com/docs/<slug> is also plain Markdown at
https://play.onejs.com/docs/<slug>.md. Start with `writing-a-game`, then
`elements-and-styling`, `stage`, `assets`, `shaders`, `rooms`,
`leaderboards`, `publishing`.

Type declarations for `oj` are at https://play.onejs.com/api/types/oj (a JSON
map of file name to `.d.ts` text), which is what the browser editor loads.

## Rules the site holds you to

- `oj` is a strict subset of OneJS. Anything that would not also work in a
  real Unity OneJS project is not in it.
- The stage is a logical size (`oj.json` → `stage.size`); the site fits it to
  the player's window. Draw in stage coordinates.
- A game cannot read its own id, reach the site's cookies, or reach another
  game. It runs on its own origin.
- No em dashes in prose. Use a colon, a comma, or two sentences.
