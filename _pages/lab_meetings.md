---
layout: page
permalink: /meetings/
title: Lab Meetings
description: Who is presenting, and when
nav: false # unlisted: reachable only by knowing the URL
sitemap: false # keep it out of sitemap.xml
noindex: true # and ask search engines not to index it
---

{% assign today = site.time | date: "%Y%m%d" | plus: 0 %}
{% assign schedule = site.data.lab_meetings | where_exp: "m", "m.cancelled == false" %}
{% assign upcoming = schedule | where_exp: "m", "m.ymd >= today" %}

<p>
  All lab meetings take place in the Gatsby seminar room, on Thursdays at 13:00.
  Only the weeks with a meeting are listed below — the weeks without one are
  marked as cancelled in the calendar.
</p>

<p class="meeting-subscribe">
  <a href="https://calendar.google.com/calendar/r?cid=ZjVjOTQ4OGY3NjliMzEzODVhNDczOTk5OTliZjdhMzQ1ODQ0NzE2NzRmMzNiYzgyMzg2YzQ3NDI0MTFiZTlkZEBncm91cC5jYWxlbmRhci5nb29nbGUuY29t">Add the lab calendar to Google Calendar</a>
  <span>
    One click, and it stays up to date by itself. Using Outlook or Calendar.app
    instead? Subscribe to <a href="https://calendar.google.com/calendar/ical/f5c9488f769b31385a47399999bf7a34584471674f33bc82386c4742411be9dd%40group.calendar.google.com/public/basic.ics">this address</a> — paste it into your
    calendar's "subscribe by URL", rather than downloading it.
  </span>
</p>

{% if upcoming.size == 0 %}

<p>No meetings are scheduled at the moment.</p>

{% else %}

<h2 class="people-section">Upcoming</h2>

<table class="meeting-table">
  <tbody>
    {% for m in upcoming %}
    <tr{% if forloop.first %} class="meeting-next"{% endif %}>
      <td class="meeting-date">{{ m.display }}</td>
      <td class="meeting-who">
        {% if m.link != "" %}<a href="{{ m.link }}">{{ m.who }}</a>{% else %}{{ m.who }}{% endif %}
        {% if m.topic != "" %}<span class="meeting-topic">{{ m.topic }}</span>{% endif %}
      </td>
    </tr>
    {% endfor %}
  </tbody>
</table>

{% endif %}

<style>
  .meeting-subscribe {
    margin-bottom: 2rem;
  }
  .meeting-subscribe span {
    display: block;
    font-size: 0.85rem;
    color: var(--global-text-color-light);
  }
  .meeting-table {
    width: 100%;
    margin-bottom: 2.5rem;
    border-collapse: collapse;
  }
  .meeting-table td {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--global-divider-color);
    vertical-align: baseline;
  }
  .meeting-date {
    width: 12rem;
    white-space: nowrap;
    color: var(--global-text-color-light);
  }
  .meeting-who {
    font-weight: 500;
  }
  .meeting-topic {
    display: block;
    font-weight: 400;
    font-size: 0.9rem;
    color: var(--global-text-color-light);
  }
  .meeting-next .meeting-date,
  .meeting-next .meeting-who {
    color: var(--global-theme-color);
  }
  @media (max-width: 576px) {
    .meeting-date {
      width: 9rem;
      white-space: normal;
    }
  }
</style>
