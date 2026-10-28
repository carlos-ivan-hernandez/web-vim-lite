# Vimlite

A very small Vimium alternative for Chrome, mostly for scrolling.

## Keys

| Key   | Action                                  |
| ----- | --------------------------------------- |
| `j`   | Scroll down (hold to keep scrolling)    |
| `k`   | Scroll up (hold to keep scrolling)      |
| `h`   | Scroll left                             |
| `l`   | Scroll right                            |
| `d`   | Scroll half a page down                 |
| `u`   | Scroll half a page up                   |
| `gg`  | Scroll to the top                       |
| `G`   | Scroll to the bottom                    |
| `zL`  | Scroll all the way right                |
| `zH`  | Scroll all the way left                 |
| `f`   | Show link hints; type a hint to click it |
| `i`   | Insert mode (keys go to the page)       |
| `Esc` | Back to normal mode / cancel hints      |

Focusing a text field switches to insert mode automatically, and `Esc` leaves the field.
Keys held with Ctrl, Alt or Cmd are always passed through to the page.

## Popup

Click the Vimlite toolbar button to:

- Turn Vimlite off for the site you're on (by host name, such as `mail.example.com`).
- Use `Cmd+Esc` instead of `Esc` to get back to normal mode, so plain `Esc` goes to
  the page. `Esc` still cancels link hints.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

After editing `content.js`, click the reload button on the extension card and refresh the page.
