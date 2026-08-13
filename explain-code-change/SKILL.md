---
name: explain-code-change
user-invocable: true
description: Explain a code change to a non-engineer as an interactive HTML walkthrough built on one carried analogy, with teaching diagrams that link to every changed file and function. Use when the user asks for a visual, ELI5, or HTML explainer of a branch, PR, diff, or merge decision.
---

# Explain Code Change

Turn a code change into something a non-engineer can **retell in their own words**.

`lavish` owns presentation and the browser review loop; this skill owns what the
page has to say. Read the installed `lavish` skill before building any HTML.

## The reader

Write for a teammate who will never open the diff — a PM, a designer, a founder.
Smart, knows the product, does not know your stack, your file names, or your
framework. They are deciding whether this is safe to merge.

They finish able to say, unprompted: what was broken, what the change does about
it, what happens when it goes wrong, and what it leaves alone. That is the
**retell test**, and every step below aims at it.

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
end-to-end. Inspect callers, trust boundaries, failure paths, and changed tests.

The diff shows what moved; it does not show what the reader is standing on.
Establish the **baseline** from the codebase rather than the PR: what this system
is for, what it produces, who reads that output, and what each noun the change
talks about actually is — where it comes from and what makes it. A reader who
does not know what the change operates on cannot follow any account of the
change, however well told.

Inventory every added or materially changed production function, method, class,
and shared constant. For declarative changes, inventory the equivalent
behavioral units: prompt sections, schema fields, config keys, migrations, or UI
copy. For each, capture:

- its plain-English job;
- **the part it plays in the fix** — the reason the change would fail without it;
- what calls it or consumes its output.

Harvest the edge cases as a list: every "what if" the change handles — bad or
missing input, two things happening at once, a dependency down, a limit hit, a
partial failure — paired with what actually happens. This list is the raw
material for step 3, and it is what earns the reader's trust.

Keep the original feature distinct from later review fixes and uncommitted work.
Group tests by file and user-visible promise; enumerate individual test functions
only when the user requests that granularity.

Bulk changes — fixtures, corpora, snapshots, generated result files — earn a
count and a sentence, never a walkthrough. Read what a result file *says*, not
the file itself. A diff whose size comes from data is not a change of that size,
and the artifact's space belongs to what changed behaviour.

**Complete when:** every changed production file and runtime-relevant behavioral
unit has a role, a part in the fix, and a place in the end-to-end flow; the
edge-case list is complete; and every noun the change depends on can be traced
to where it comes from.

## 3. Find the through-line

Pick one **through-line**: an everyday situation with the same shape as the
problem the change solves. Everything downstream is told through it.

A through-line earns its place by passing all four:

- **The problem maps, not just the fix.** The reader feels the pain in the
  analogy before hearing the solution.
- **It runs on ordinary life.** Mail, keys, queues, kitchens, filing cabinets,
  road signs. No second technical domain standing in for the first.
- **It has a before and an after**, and the difference is visible.
- **It stretches to the edges.** Ask every "what if" from step 2 inside the
  analogy. If answering one forces you back into code vocabulary, the analogy is
  too small — pick a different one.

One through-line, not three; mixed metaphors cost more than they give. Name the
single place it breaks down, so the reader knows where to stop trusting it.

**Complete when:** every "what if" from step 2 has an answer stated in the
through-line's own words.

## 4. Write the change story

Draft the content before styling it. These are the pieces the page must carry,
and this is the order the reader meets them in: oriented in the real system
first, and only then handed the analogy that stands for it. An analogy that
arrives before the world it describes reads as a non-sequitur however apt it is.
Each piece opens in the through-line and lands in the code:

1. **The world before the change** — what this system does, what it produces, and
   who reads that output. Then the stakes: what the defect cost someone, in one
   sentence, with real numbers when they motivated the change.
2. **The through-line, before and after** — the situation, the pain, the fix.
3. **The legend** — every noun in the through-line mapped to the real thing it
   stands for and the name it carries in the code. An analogy with no decoder
   ring is a story the reader cannot attach to anything.
4. **The smallest real example** — one concrete input that went wrong before and
   goes right now. Real values from the codebase or the data, never `foo`.
5. **What the change actually does** — each moving part named for its job in the
   through-line first, its code name second.
6. **What if…** — the edge cases as questions the reader would ask, each answered
   in through-line terms, then in one line of mechanism.
7. **Blast radius and reversibility** — if this is wrong, what breaks, who
   notices first, and how it gets undone.
8. **Changed and deliberately untouched**, side by side.
9. **File and function walkthrough** — every production symbol from step 2, each
   entry leading with the part it plays in the through-line, then what it does.
10. **Tests and evals** — a table of what each group promises, in the reader's
    terms, plus the headline number an eval actually produced. The promise and
    the result, not the harness.
11. **Validation and verdict** — what was actually run, and what still gates merge.

Every technical term the reader meets is one you chose to teach: introduce it
inside the through-line, in plain words, at the moment it first matters.

**Complete when:** every inventoried symbol names its part in the through-line
before it names its mechanics, every noun in the through-line appears in the
legend, and a reader who stops after item 6 passes the retell test.

## 5. Build the HTML review surface

Open every matching `lavish` playbook — this artifact needs `diagram`, `table`,
and `comparison` at minimum, plus `code` when snippets appear. Follow Lavish's
design-source priority. Create `.lavish/<change-slug>-explainer.html`.

**Prefer the picture.** Whatever can be shown is shown; prose is the fallback for
what genuinely has no shape — rationale, tradeoffs, open questions. A paragraph
that could have been a diagram is a paragraph the reader has to hold in their
head.

**Draw teaching diagrams** — the kind made to teach a concept to someone who has
never met it, not to document a system. The test: it still makes sense when the
codebase does not exist. A picture that only means something to someone who
already knows the system is an architecture diagram; redraw it.

Reach for what a teacher reaches for: before and after, the shape of the problem,
what happens to each kind of input, a spectrum with the cases placed along it, a
rule and its exceptions. Chart real data whenever real numbers motivated the
change — a bar of what the logs actually looked like beats any drawing. A
code-flow diagram is one visual among many, never the centerpiece.

**Draw the baseline too.** The world before the change is what the reader has
least of and needs first, so it earns pictures rather than prose: render the
thing itself — one real record, one real screen, the real shape of the data —
rather than describing it in words. One of those pictures is a **you are here**:
the system at a glance with the changed part marked, so the reader sees both how
little of it this touches and what it sits between.

Open the page on the baseline — the you-are-here, then the thing itself. Only
after that build the through-line's before/after as the **map**, which by then
lands on a reader who knows what it stands for. Every part of the map is
clickable, jumps to the section explaining that part, and offers a way back.
Follow the playbook's hybrid shape — overview visual first, detail cards beneath.

Hand-author that map as SVG or CSS grid rather than a Mermaid block: Lavish turns
`.mermaid` containers into editable whiteboards on click, which takes the click
away from your links. Mermaid stays right for sequence and state diagrams, where
the click is not doing work.

Keep the legend beside the hero map rather than buried below it, so the reader
meets the analogy and its decoder in the same screenful, and give every
unavoidable technical term a hover gloss in plain words.

**Complete when:** every section of the change story is on the page, every
diagram still makes sense with no codebase behind it, every inventoried file and
symbol is findable by name, and every clickable part of the hero visual lands on
the section explaining it.

## 6. Open, audit, and hand off

Follow the installed `lavish` skill's browser audit and feedback loop through
handoff. Read the page once as the reader before handing it over, and fix
anything that only makes sense to someone who has seen the diff.

When Lavish is unavailable, still create a standalone portable HTML file and
state that collaborative annotations are unavailable.

Deliver the review URL or local artifact link, name the design source used, and
name the through-line.

**Complete when:** the browser reports no severe layout warnings and the user has
a working review link.

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
- Keep the through-line out of the evidence sections. An analogy explains what
  the code does; it never stands in as proof that the code works.
