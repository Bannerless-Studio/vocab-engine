# StoryWeaver licence scout 2026-10-08
**Verdict: CONDITIONAL yes.** Text+images of books are CC BY 4.0 platform-wide (ToS 9A + attributions page). Exclude Read Along/audio/video (CC BY-NC-ND 4.0). Per-book licence is shown only on each book's attribution page, which anonymous reads gate after ~3 reads (401); not circumvented. 1 book verified in full (4252, CC BY on text+all 8 images); other 69 rest on platform-wide claim + API metadata.
ToS quote (/en/terms-and-conditions 9A): "a) Creative Commons Attribution 4.0 International (CC-BY 4.0)... b) ...(CC-BY-NC-ND 4.0). This License shall apply only to the Read Along Feature including all videos". Footer: "The books on StoryWeaver are licensed under the Creative Commons CC BY 4.0 license." No NC variant for books; image rights = text rights ("all stories and images" CC BY 4.0).
Attribution (attributions page; must keep notices, cite author/illustrator/translator/publisher/donor, title, platform, "CC BY 4.0" + link, flag changes). Translated template: <Title> (lang), translated by <T> (© <T>, <yr>), based on original story <Orig> (lang), written by <A>, illustrated by <I>, published by <P> (© <P>, <yr>) under a CC BY 4.0 license on StoryWeaver. Read, create and translate stories for free on www.storyweaver.org.in. Per-book strings incl. © years sit on the book's last page (read API pages[].html, "Story Attribution"/"Images Attributions"), not in search/detail API.
Scale filter: NO licence field anywhere. Detail API gives publisher.name, originalStory.originalPublisher, isTranslation/isRelevelled/isAdapted, isAudio, isGif, copyrightNotice (free text, only publisher boilerplate; none stated NC). Use isAudio/isGif=false to drop NC-ND readalongs (Arabic 227258/229018, Hindi 342/170/1910, Urdu 553444/304481 are isAudio). Original-publisher spread: Pratham, Room to Read, Book Dash, African Storybook, StoryWeaver Community: all flagged CC BY on platform.
Export: read API /api/v1/stories/<slug>/read (HTML per page + attribution page; 401 after anon quota, ignore_count=true always 401); PDF Download is gated by a form (not tested); search API per_page<=60 pages. Story page HTML is an SPA shell (no licence text); rendered page shows footer line only.
Table: lang(hits) = id title L=level T/O(translation/original); all show platform CC BY 4.0 (unverified per book); attribution = template above.
- Chinese (Simplified) (406, label 'Chinese (Simplified)'): 19272 L1 T; 577893 L2 T; 266453 L3 T; 92446 L4 T; 99713 L1 T
- Japanese (1344, label 'Japanese'): 279386 L1 T; 20795 L2 T; 31840 L3 O; 261645 L4 T; 20101 L1 T
- Korean (996, label 'Korean'): 251215 L1 T; 154397 L2 T; 245109 L3 T; 242809 L4 T; 21153 L1 T
- French (1496, label 'French'): 4176 L1 T; 95463 L2 T; 9096 L3 T; 25504 L4 T; 63657 L5 T
- Spanish (1435, label 'Spanish'): 130744 L1 T; 127843 L2 T; 423524 L3 T; 432310 L4 T; 193225 L2 T
- German (210, label 'German'): 20162 L1 T; 4528 L2 T; 8932 L3 T; 155014 L4 T; 3892 L2 T
- Italian (1054, label 'Italian'): 113761 L1 O; 108100 L2 T; 55347 L3 T; 28329 L4 T; 7686 L1 T
- Russian (124, label 'Russian'): 20710 L1 T; 107332 L2 T; 20546 L3 T; 7498 L1 T
- Urdu (832, label 'Urdu'): 553444 L1 T [audio]; 304481 L2 T [audio]; 359760 L3 T; 318904 L4 T; 59910 L2 T
- Hindi (5133, label 'Hindi'): 342 L1 O [audio]; 170 L2 T [audio]; 7022 L3 T; 529 L4 T; 1910 L2 O [audio]
- Persian (254, label 'Farsi (Samim)'): 108369 L1 T; 147560 L2 T; 59052 L3 T; 150450 L4 T; 59862 L3 T
- Indonesian (6771, label 'Bahasa Indonesia'): 539370 L1 T; 540501 L2 T; 40566 L3 T; 318750 L4 T; 92469 L1 T
- Arabic (527, label 'Arabic'): 227258 L1 T [audio]; 229018 L2 T [audio]; 228311 L3 T; 230330 L4 T; 113224 L1 T
- Swahili (260, label 'Kiswahili'): 79070 L1 T; 32977 L2 O; 95384 L3 T; 95938 L4 T; 56283 L1 T
Titles/publishers/original publishers per row: vocab-engine/docs/scouts/storyweaver-licence-2026-10-08.rows.json. Mostly translations of Pratham Books originals; originals exist in Japanese 31840, Italian 113761, Hindi, Swahili 32977.
URLs read: storyweaver.org.in/faqs, /en/attributions, /en/terms-and-conditions, /en/stories/4252-fat-king-thin-dog (+?mode=read), /api/v1/stories/4252(+/read), /api/v1/books-search (14 langs; labels: 'Chinese (Simplified)', 'Farsi (Samim)', 'Bahasa Indonesia', 'Kiswahili'), /api/v1/stories/<id> x70. /license,/terms-of-use 404. No 429 hit. ~4 anonymous reads consumed.
