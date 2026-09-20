# Portfolio

Personal portfolio site: plain HTML, CSS and JavaScript with no build step. It's hosted on GitHub Pages.

```
index.html                       Home: intro, project cards, about, contact
assets/site.css                  Shared styles (light + dark mode)
projects/timetable-solver/       Project 1: timetable solver using SAT (live demo + write-up)
  js/solver.js                   DPLL SAT solver with two watched literals
  js/encode.js                   Timetable → CNF (exactly-one, clashes, blocks, sequential counter)
  js/app.js                      Page UI
tests/solver.test.mjs            Tests: solver vs brute force, pigeonhole, counter, timetable
```

## Run locally

ES modules don't load over `file://`, so serve the folder:

```
python3 -m http.server 8000     # then open http://localhost:8000
npm test                        # runs the tests (Node 18+)
```

## Deploy to GitHub Pages

1. Create a public repo named `thm-phm.github.io` (this gives you the root URL).
2. Upload the *contents* of this folder to `main` (Add file → Upload files), so `index.html` is at the top level.
3. Repo → Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / `(root)`.
4. The site appears at `https://thm-phm.github.io` within a minute or two.

## Before publishing

Search for `TODO` and fill in:

- the About paragraphs on the home page, in your own words
- the "How it works" write-up on the project page, in your own words

## Adding a project

Copy `projects/timetable-solver/` as a template, then add a card in the `#projects` section of `index.html`.
