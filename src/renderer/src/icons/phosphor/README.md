# Phosphor icons, vendored

Unmodified files from `@phosphor-icons/core` 2.1.1 (MIT; `LICENSE` beside
them; https://github.com/phosphor-icons/core), renamed only: `<name>-16.svg`
is the package's **light** weight (`assets/light/<phosphor-name>-light.svg`),
used at 16px in controls; `<name>-24.svg` is the **regular** weight
(`assets/regular/<phosphor-name>.svg`), used at 24px in empty states and
headers; `<name>-fill.svg` is the **fill** weight for a toggled state.

| Ours                        | Phosphor                             |
| --------------------------- | ------------------------------------ |
| train                       | train                                |
| map                         | map-trifold                          |
| layers                      | stack                                |
| route                       | path                                 |
| clock                       | clock                                |
| play, pause                 | play, pause (and their fill weights) |
| export                      | export                               |
| settings                    | gear                                 |
| warning, info, check, close | warning, info, check, x              |
| add, trash, edit            | plus, trash, pencil-simple           |
| back, forward               | arrow-left, arrow-right              |
| spinner                     | spinner-gap                          |

Adding a glyph: copy both weights from the package at the version above and
add the row; a glyph the set lacks is drawn by hand to the same grid in the
parent directory and said to be the app's own (`docs/DESIGN.md`, section 6).
