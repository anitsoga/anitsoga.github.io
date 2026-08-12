---
layout: profiles
permalink: /people/
title: People
description: Lab members
nav: true
nav_order: 3
hide_header: true # suppresses the on-page "People" / "Lab members" heading

# Sections render as <h2>, subsections as a smaller <h3>.
#   profiles: -> photo + bio entries. `image` may name a file that is not in
#                assets/img/ yet; the photo is omitted until the file is added,
#                rather than rendering as a broken image.
#   people:   -> plain name / affiliation list. Add `url:` to link a name.
profile_sections:
  - title: Current Members
    subsections:
      - title: Principal Investigator
        profiles:
          - image: Agostina_pic.jpg
            content: about_Agos.md
            more_info: >
              <p>Lecturer in Theoretical Neuroscience</p>

      - title: Postdocs
        profiles:
          - image: Matt_pic.jpg
            content: about_Matt.md
          - image: Sam_pic.jpg
            content: about_Sam.md
          - image: Pratyusha_pic.jpg
            content: about_Pratyusha.md

      - title: PhD Students
        profiles:
          - image: Jan_pic.jpg
            content: about_Jan.md
          - image: Mateo_pic.jpg
            content: about_Mateo.md
          - image: Jake_pic.jpg
            content: about_Jake.md
          - image: Ale_pic.jpg
            content: about_Ale.md
          - image: Hantao_pic.jpg
            content: about_Hantao.md

      - title: MSc Students
        profiles:
          - image: Ravi_pic.jpg
            content: about_Ravi.md
          - image: Mikolaj_pic.jpg
            content: about_Mikolaj.md

      # Students based in other labs, collaborating on projects: no photo or bio.
      - title: Affiliated PhD Students
        people:
          - name: QianQian Feng
            affiliation: "Sahani's Lab"
          - name: Mohadeseh Shafiei Kafraj
            affiliation: "Latham's Lab"
          - name: Jakub Wornbard
            affiliation: "Gretton's Lab"

  - title: Collaborators
    people:
      - name: Moritz Helias
        affiliation: >-
          Institute for Advanced Simulation (IAS-6), Jülich Research Centre &
          Faculty of Physics, RWTH Aachen University
      - name: Kenneth D. Miller
        affiliation: Center for Theoretical Neuroscience, Columbia University
      - name: Arthur Pellegrino
        url: https://sites.google.com/view/arthur-pellegrino/home
        affiliation: Data Science Center, École Normale Supérieure, PSL

  - title: Past Members
    subsections:
      - title: Postdocs
        people:
          - name: Arthur Pellegrino
            url: https://sites.google.com/view/arthur-pellegrino/home
            note: "Current position: Data Science Center, École Normale Supérieure, PSL"
      - title: PhD Students
        people:
          - name: Ho Yin Chau
            url: https://scholar.google.com/citations?user=rNnV8F8AAAAJ&hl=en
            note: "Current position: Postdoc in Srdjan Ostojic's Lab at ENS"
          - name: Tuan Nguyen
            url: https://scholar.google.com/citations?user=tsjlBDsAAAAJ&hl=en
            note: "Current position: Postdoc in Tatiana Engel's Lab at Princeton"
      - title: MSc Students
        people:
          - name: Gianluca Carrozzo
          - name: Paul Chainieux
          - name: Melina Laimon
          - name: "David O'Neill"
---
