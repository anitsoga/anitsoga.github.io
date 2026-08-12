# Adding a news item

Create one file per item, named `YYYY-MM-DD-short-slug.md`:

```
---
layout: post
date: 2026-07-13
inline: true
related_posts: false
---

Agos teaches in [The Brain Prize Course](https://cajal-training.org/...) in Lisbon, Portugal
```

**The order on the page comes from the `date:` field in the front matter, not from
the filename.** Jekyll sorts the collection by date, so you can add an item for any
date at any time and it lands in the right place. Nothing else needs renumbering or
renaming — this is why files are no longer called `announcement_1.md`, `announcement_2.md`
and so on. The date in the filename is there only so the directory listing sorts
chronologically; keep it the same as the `date:` field.

If two items share a date, they are ordered by filename, so bump the day (or add a
suffix) if you care which comes first.

## Longer items with their own page

Set `inline: false` and add a `title:`. The body then becomes a separate page at
`/news/<filename-slug>/`, and the news list shows the title as a link.

To pin a specific URL — for instance to keep an old link working after renaming a
file — add `slug: whatever-you-want` to the front matter. Two files do this
(`slug: announcement_3` and `slug: announcement_6`) so their original URLs from the
old numbered scheme still resolve.
