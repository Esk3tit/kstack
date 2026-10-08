---
name: explain-code-change
user-invocable: true
description: Explain a code change as a layered interactive HTML page. A dense plain-language summary of what and why sits on top, then diagrams, animations, and a walkthrough of every changed file and function sit below it. Use when the user asks for a visual, ELI5, or HTML explainer of a branch, PR, diff, or merge decision.
---

# Explain Code Change

Turn a code change into a page the reader can judge in one screen and dig into
for as long as they want.

The page is a **standalone report**: one self-contained HTML file the reader
opens in their own browser and reads like a well-made document.

## The reader

The reader is deciding one thing first: **is the approach sound?** They might be
the author checking their own work at the end of a long day, a PM, or a
reviewer. They know the product. They may not know this part of the code.

So the page is **layered**. The top layer answers what and why, and it is dense
enough to judge the approach. Each layer below adds detail for a reader who
wants it. A reader who stops at any layer leaves with a true picture, only a
less detailed one.

**The top test:** after the first screen alone, the reader can say what changed,
why, how it works in one breath, why this way and not another, and what breaks if
it is wrong.

## Plain writing

Every word on the page follows these rules:

- Explain with the real thing. Use real records, real values, real screens, and
  real numbers from the codebase or the data. Write no analogies and no
  metaphors. The real example is the explanation.
- Use small words and short sentences, with one idea per sentence.
- Define a technical term in plain words the first time it appears. After that,
  use the same word every time.
- State facts and numbers. Cut words that only set a mood.
- Run the installed `unslop` skill over the page copy before you hand it off,
  when it is available.

## 1. Fix the review boundary

Read the repository instructions. Resolve the fixed point from the user's
explicit ref, the PR base, or the tracked default branch, in that order. Include
both committed and working-tree changes:

```bash
git diff --name-status <base>...HEAD
git diff --name-status HEAD
git log <base>..HEAD --oneline
```

Record the branch, dirty state, and whether reported checks are local or external.

When no Git repository exists, treat the user-provided patch or files as the
fixed boundary and inventory them directly.

**Complete when:** every path in both name-status inventories is either covered
in the artifact or explicitly excluded with a reason.

## 2. Trace the actual behavior

Read the complete diff and enough surrounding code to follow the changed path
end to end. Inspect callers, trust boundaries, failure paths, and changed tests.

The diff shows what moved. It does not show what the reader is standing on.
Establish the **baseline** from the codebase rather than the PR: what this system
is for, what it produces, who reads that output, and what each noun the change
talks about actually is, where it comes from, and what makes it.

Find the **approach** and the options it beat. Read the PR body, commit
messages, review threads, and code comments for the alternatives the author
considered. When the record names none, say so on the page and name the obvious
alternative yourself, labeled as your inference.

Inventory every added or materially changed production function, method, class,
and shared constant. For declarative changes, inventory the equivalent
behavioral units: prompt sections, schema fields, config keys, migrations, or UI
copy. For each, capture:

- its plain-English job;
- **its part in the fix**, meaning the reason the change would fail without it;
- what calls it or consumes its output.

Harvest the edge cases as a list: every "what if" the change handles, such as bad
or missing input, two things happening at once, a dependency down, a limit hit,
or a partial failure. Pair each with what actually happens.

Pick the **smallest real example**: one concrete input that went wrong before and
goes right now, with real values, never `foo`. It carries the animations in
step 4.

Keep the original feature distinct from later review fixes and uncommitted work.
Group tests by file and user-visible promise. Enumerate individual test
functions only when the user requests that granularity.

Bulk changes, such as fixtures, corpora, snapshots, and generated result files,
earn a count and a sentence, never a walkthrough. Read what a result file *says*,
not the file itself. A diff whose size comes from data is not a change of that
size.

**Complete when:** every changed production file and behavioral unit has a job,
a part in the fix, and a place in the end-to-end flow; the edge-case list is
complete; the approach has at least one named alternative; and the smallest real
example is picked.

## 3. Write the layers

Draft the content before styling it. The page has three layers, in this order.

### Layer 1: the summary (one screen)

Dense and compact. No scrolling needed to judge the approach.

1. **One line:** what this change does, in plain words.
2. **Why:** the problem, what it cost someone, with the real number when one
   exists.
3. **How:** the approach in two or three short sentences, beside one
   before/after picture of the smallest real example.
4. **Why this way:** the alternatives and why each lost, one line each.
5. **Risk:** what breaks if this is wrong, who notices first, and how to undo it.
6. **Status:** what was run, what passed, and what still gates merge.

### Layer 2: how it works

1. **The system before the change.** What it does, what it produces, and who
   reads that output. Start with a **you are here** picture: the system at a
   glance with the changed part marked.
2. **The change, step by step.** The smallest real example walks through the old
   path and the new path.
3. **What if…** Each edge case as a question the reader would ask, then what
   happens, then one line of mechanism.
4. **Changed and deliberately untouched**, side by side.

### Layer 3: the code and the evidence

1. **File and function walkthrough.** Every production symbol from step 2. Each
   entry leads with its part in the fix, then what it does, then what calls it.
2. **Tests and evals.** A table of what each test group promises, in the
   reader's terms, plus the headline number an eval actually produced.
3. **Validation and verdict.** What was actually run, and what still gates merge.

**Complete when:** the layer 1 draft passes the top test on its own; every
inventoried symbol appears in layer 3 with its part in the fix; and every edge
case from step 2 appears in layer 2.

## 4. Build the report

Write one HTML file, `<change-slug>-explainer.html`. Save it where the
repository's instructions put local artifacts. With no such rule, use a
gitignored path or the session scratchpad. It never lands in tracked files.

### Design

The report has its own design, made for reading. It stays independent of the
product's theme and of any review tool's chrome.

- **Self-contained.** All CSS and JS live inline. The only outside requests are
  Google Fonts. Use no CSS framework or component library.
- **Report typography.** A serif display face for headings, a clean sans for
  body text, and a mono face for code (for example Source Serif 4, Inter,
  JetBrains Mono). Text runs at 14–15px, with comfortable line height.
- **Light and dark.** Define every color as a token on `:root`. Redefine the
  tokens under `prefers-color-scheme: dark` and under `[data-theme="dark"]`, and
  add a theme toggle. Color SVG through the same tokens, with CSS `fill` and
  `stroke`, so diagrams follow the theme.
- **Calm surfaces.** An off-white page, white cards with a hairline border and
  rounded corners, one accent color, and green, red, and amber only for status.

### Layout

- A sticky contents sidebar on the left that highlights the section in view.
  On narrow screens it becomes a row of pills at the top.
- Layer 1 is fully open and fits the first screen at desktop width.
- Layers 2 and 3 sit below as collapsible sections the reader opens on demand.
- Every claim in layer 1 links down to the section that backs it up. A link into
  a closed section opens it.

### Pictures

**Prefer the picture.** Whatever can be shown is shown. Prose is for what has no
shape: rationale, tradeoffs, open questions. When unsure whether a picture earns
its place, keep it. A diagram costs the reader far less than a paragraph.

Draw diagrams made to teach someone who has never seen the system. The test: it
still makes sense when the codebase does not exist. Reach for before and after,
the shape of the problem, what happens to each kind of input, a spectrum with
the cases placed along it, and a rule with its exceptions. Chart real data when
real numbers motivated the change. Render the real thing itself (one real record,
one real screen, the real shape of the data) instead of describing it in words.

Hand-author every diagram as inline SVG, sized by `viewBox`. Keep SVG labels to
a few words, and put the prose beside the figure in HTML. Show code as small
hand-styled diff blocks of the lines that carry the fix, not whole files.

### Motion and interaction

Animate what changes over time: the smallest real example moving through the
old path and then the new one, two requests racing, a retry, a queue draining, a
value changing as it passes each step. Each animation:

- has play, pause, and step-forward/back controls, with a caption that names
  what is happening at each step;
- shows the same steps for "before" and "after", so the reader sees exactly
  where the paths split;
- respects `prefers-reduced-motion` by opening in step mode;
- ends on a final frame that reads correctly as a still picture.

Add interaction wherever it answers a question faster than reading would:

- a **before/after toggle** on any picture that has both states;
- an **input picker** that lets the reader choose one of the real edge-case
  inputs and watch which path it takes;
- **hover glosses** that define each technical term in plain words;
- **click-to-code links** from each box in a diagram to its entry in the
  layer 3 walkthrough, with a way back.

Every animation and control shows real behavior from step 2.

**Complete when:** the first screen holds all of layer 1; every section of the
draft is on the page; every diagram still makes sense with no codebase behind
it; every flow that changes over time has a stepped animation with controls;
every inventoried file and symbol is findable by name; and every link and
clickable part lands on the section it names.

## 5. Open and hand off

The report exists so the reader can review and ship fast, and handoff speed
matters more than visual polish. Hand it off straight from the source: skip the
headless browser, screenshots, and layout checks. The reader flags any visual
problem they hit, and you fix it then.

Read the layer 1 copy once against the top test, and fix anything that only
makes sense to someone who has seen the diff. Then open the file in the user's
browser (`open <path>` on macOS) and give them the path.

**Complete when:** the layer 1 copy passes the top test and the report is open
in the user's browser.

## Evidence language

- Say `N tests passed` only from an observed result covering those tests.
- Say `locally merge-ready` only when the relevant local checks passed.
- List uncommitted files when the artifact includes working-tree changes.
- State external gates explicitly instead of folding them into a green local
  verdict.
- Separate what you ran from what you were told. Results the author reported and
  you did not reproduce are neither observed nor an external gate: attribute them
  to their source, and keep them out of the block reporting your own.
- Describe uncertainty through its actual fallback. Prefer "ambiguous evidence
  produces no highlight" over an absolute promise of zero future errors.
- Label inference as inference. An alternative you named yourself, or a reason
  the record does not state, says so on the page.
