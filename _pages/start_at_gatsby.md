---
layout: page
permalink: /startatgatsby/
title: Start your life at Gatsby
hide_header: true # the doc supplies its own title
nav: false # unlisted: reachable only by knowing the URL
sitemap: false # keep it out of sitemap.xml
noindex: true # and ask search engines not to index it
---

{% include start_at_gatsby.html %}

<style>
  .gatsby-doc p {
    margin-bottom: 0.75rem;
    line-height: 1.55;
  }
  .gatsby-doc > p:first-child strong {
    font-size: 1.6rem;
  }
  .gatsby-doc > p strong {
    font-size: 1.15rem;
  }
  .gatsby-doc ul,
  .gatsby-doc ol {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
  }
  .gatsby-doc li {
    margin-bottom: 0.4rem;
    line-height: 1.55;
  }
  /* Google exports sub-lists as siblings, so the indent comes from the level
     class the converter adds rather than from real nesting. Every numbered list
     in this doc sits under one of the bullets, so ol starts one level in. */
  .gatsby-doc ol,
  .gatsby-doc ul.lvl-1 {
    padding-left: 3.4rem;
  }
  .gatsby-doc ol.lvl-1,
  .gatsby-doc ul.lvl-2 {
    padding-left: 5.3rem;
  }
  .gatsby-doc ol.lvl-2 {
    padding-left: 7.2rem;
  }
  .gatsby-doc li strong {
    font-size: 1.15rem;
  }
  .gatsby-doc a {
    word-break: break-word;
  }
</style>
