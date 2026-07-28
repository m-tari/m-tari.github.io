---
layout: page
title: projects
permalink: /projects/
description: Selected projects spanning AI agents, research tooling, and computational fluid dynamics.
nav: true
nav_order: 2
---

{% assign sorted_projects = site.projects | sort: "importance" %}
{% for project in sorted_projects %}
<article class="mb-5" style="display: block; width: 100%;">
  <h3 class="mt-0 mb-2">
    {% if project.redirect %}
      <a href="{{ project.redirect }}" target="_blank" rel="noopener">{{ project.title }}</a>
    {% else %}
      {{ project.title }}
    {% endif %}
  </h3>
  {{ project.content }}
</article>
{% endfor %}
