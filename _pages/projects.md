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
<article class="project-entry">
  {% if project.imgs %}
  <div class="project-media project-media--triangle" aria-hidden="true">
    {% for src in project.imgs %}
      <img src="{{ src | relative_url }}" alt="" loading="lazy">
    {% endfor %}
  </div>
  {% elsif project.img %}
  <div class="project-media">
    <img src="{{ project.img | relative_url }}" alt="{{ project.title }}" loading="lazy">
  </div>
  {% else %}
  <div class="project-media project-media--empty" aria-hidden="true"></div>
  {% endif %}
  <div class="project-body">
    <h3 class="mt-0 mb-2">
      {% if project.redirect %}
        <a href="{{ project.redirect }}" target="_blank" rel="noopener">{{ project.title }}</a>
      {% else %}
        {{ project.title }}
      {% endif %}
    </h3>
    {{ project.content }}
  </div>
</article>
{% endfor %}
