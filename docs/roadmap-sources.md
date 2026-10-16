# Roadmap sources

The researched roadmap library lives in `apps/api/src/modules/roadmaps/library/` (one JSON file per roadmap). Every college gets these installed and owns its copies from then on through the normal review workflow.

## How the library was researched

- **Method:** web searches only (this build environment cannot open pages). Every URL in the library appeared in a search result; none were typed from memory.
- **Sources allowed:** official documentation, roadmap.sh, NPTEL/SWAYAM and university course pages, professional bodies, official exam and recruitment sites, and well-known free curricula. No blogs, listicles or coaching sites.
- **Resources** are free to access (some NPTEL courses charge only for an optional certificate exam).
- **Time estimates** are editorial judgements for a part-time student and are shown as "about".
- **No exam dates, fees, vacancies or cut-offs.** Steps link to the official page instead.
- **`needsReview`** marks every step whose claim rests on editorial judgement rather than a confirmed source. The app shows these with a dashed outline and a note.
- **Link check:** `pnpm --filter @campuslink/api roadmaps:verify` fetches every cited URL in GitHub Actions (feeds workflow, job `links`) on every library change and weekly.

## Link check results

| Date                     | URLs | Pass | Inconclusive | Fail |
| ------------------------ | ---- | ---- | ------------ | ---- |
| 2026-10-16 (first run)   | 252  | 238  | 5            | 9    |
| 2026-10-16 (after fixes) | 251  | 242  | 9            | 0    |
| 2026-10-16 (26 roadmaps) | 428  | 388  | 36           | 4    |

**Fixed after the first run:**

- The Odin Project moved its "Getting hired" lessons. The old addresses redirected through plain http, which the safe fetcher refuses, so they were updated to the current https lesson URLs.
- A DataTalks.Club wiki page returned 404 and was removed. Its step in the data-engineer roadmap is now marked "needs review".

**Fixed after the 26-roadmap run:** three archived NPTEL course pages (a chemical safety course, a surveying course and a soft-skills page) and IndianOil’s 2019 GATE advertisement PDF now return 404 and were removed. The chemical process-safety and interview steps are now marked "needs review".

**Inconclusive** (the site refused an automated or overseas client; these are not counted as broken). They should be re-checked by hand from India:

- `upsc.gov.in` (403, or connection refused), `bel-india.in` and `nptel.ac.in/courses/106106179` (connection refused): the Indian government and NPTEL sites appear to block overseas runners.
- `wiki.gnuradio.org` and `mathworks.com` (403 to automated clients).
- An IIT Madras press release (redirect loop for clients without cookies).
- An NN/g PDF report (connection reset).
- Others (403 to automated clients): picoCTF, Autodesk Education, Raspberry Pi docs, the Barr Group coding standard, Palantir's blog, the TGPSC site and UPSC PDFs.

## Research passes

- **First pass:** 16 roadmaps (software, data and AI, design and product, ECE, EEE).
- **Second pass:** 10 roadmaps (cybersecurity, blockchain, game development, forward-deployed engineering, higher studies, government exams, mechanical, civil, chemical, embedded and IoT). The first pass ran out of web-search budget before reaching these, so they were left out rather than written from memory.
- **Notes from the second pass:**
  - COAP is hosted by a different IIT each year, so its link needs updating yearly.
  - TGPSC (formerly TSPSC) is cited at the address search returned.
  - The forward-deployed engineering roadmap rests mainly on Palantir's own engineering blog, because no open roadmap exists for the role. Tracking parameters were removed from those links.

## Roadmaps

### Backend Developer (`backend`)

Software · branches CSE, IT · 10 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Backend Developer Roadmap – roadmap.sh](https://roadmap.sh/backend)
- [API Design Roadmap – roadmap.sh](https://roadmap.sh/api-design)
- [20 Backend Project Ideas – roadmap.sh](https://roadmap.sh/backend/project-ideas)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)

<details><summary>All 32 cited links</summary>

- [The 5 Best Backend Development Languages – roadmap.sh](https://roadmap.sh/backend/languages)
- [The Python Tutorial](https://docs.python.org/3/tutorial/index.html)
- [Learn Java – Dev.java](https://dev.java/learn/)
- [Learn Node.js – nodejs.org](https://nodejs.org/learn)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [Pro Git (free book)](https://git-scm.com/book/en/v2)
- [Overview of HTTP – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [HTTP request methods – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods)
- [Routing – Express.js](https://expressjs.com/en/guide/routing/)
- [Hello world example – Express.js](https://expressjs.com/en/starter/hello-world/)
- [Writing middleware – Express.js](https://expressjs.com/en/guide/writing-middleware/)
- [Python Backend Development: Build Your First API – roadmap.sh](https://roadmap.sh/python/backend)
- [CS50's Introduction to Databases with SQL](https://cs50.harvard.edu/sql/)
- [PostgreSQL Tutorial – PostgreSQL Documentation](https://www.postgresql.org/docs/current/tutorial.html)
- [Password Storage Cheat Sheet – OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Session Management Cheat Sheet – OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Top 10 API Security Risks – 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [Build and share a containerized application – Docker Docs](https://docs.docker.com/get-started/introduction/)
- [Get started – Docker Docs](https://docs.docker.com/get-started/)
- [What is Docker? – Docker Docs](https://docs.docker.com/get-started/docker-overview/)
- [System Design Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/system-design.pdf)
- [E-Commerce API Project Idea – roadmap.sh](https://roadmap.sh/projects/ecommerce-api)
- [Backend Projects – roadmap.sh](https://roadmap.sh/backend/projects)
- [Todo List API Project Idea – roadmap.sh](https://roadmap.sh/projects/todo-list-api)
- [What Companies Want – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-companies-want)
- [Preparing to Interview and Interviewing – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-preparing-to-interview-and-interviewing)
- [CSES Problem Set](https://cses.fi/)
- [Strategy – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-strategy)

</details>

### Blockchain Developer (`blockchain`)

Software · branches CSE, IT · 9 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Blockchain Developer Roadmap – roadmap.sh](https://roadmap.sh/blockchain)
- [Ethereum development documentation – ethereum.org](https://ethereum.org/developers/docs/)
- [Blockchain and Money – MIT OpenCourseWare](https://ocw.mit.edu/courses/15-s12-blockchain-and-money-fall-2018/)

<details><summary>All 24 cited links</summary>

- [Ethers.js v6 documentation](https://docs.ethers.org/v6/)
- [JavaScript Guide – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)
- [Learn web development – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Learn_web_development)
- [Blockchain Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/blockchain.pdf)
- [Bitcoin: A Peer-to-Peer Electronic Cash System (paper)](https://bitcoin.org/bitcoin.pdf)
- [Session 3: Blockchain Basics & Cryptography – MIT OCW](https://ocw.mit.edu/courses/15-s12-blockchain-and-money-fall-2018/resources/session-3-blockchain-basics-cryptography/)
- [Introduction to smart contracts – ethereum.org](https://ethereum.org/developers/docs/smart-contracts/)
- [Technical intro to Ethereum – ethereum.org](https://ethereum.org/developers/docs/intro-to-ethereum/)
- [Smart contract languages – ethereum.org](https://ethereum.org/developers/docs/smart-contracts/languages/)
- [Introduction to Smart Contracts – Solidity docs](https://docs.soliditylang.org/en/latest/introduction-to-smart-contracts.html)
- [Anatomy of smart contracts – ethereum.org](https://ethereum.org/developers/docs/smart-contracts/anatomy/)
- [Testing smart contracts – ethereum.org](https://ethereum.org/developers/docs/smart-contracts/testing/)
- [Getting Started – Foundry Book](https://book.getfoundry.sh/getting-started/first-steps)
- [Tests – Foundry Book](https://book.getfoundry.sh/forge/tests)
- [Smart contract security – ethereum.org](https://ethereum.org/developers/docs/smart-contracts/security/)
- [A guide to smart contract security tools – ethereum.org](https://ethereum.org/developers/tutorials/guide-to-smart-contract-security-tools/)
- [Smart contract security checklist – ethereum.org](https://ethereum.org/developers/tutorials/secure-development-workflow/)
- [Interacting with smart contracts – ethereum.org](https://ethereum.org/developers/docs/smart-contracts/interacting/)
- [Hello World Smart Contract for Beginners – ethereum.org](https://ethereum.org/developers/tutorials/hello-world-smart-contract/)
- [Education & community resources – ethereum.org](https://ethereum.org/developers/tools/education/)
- [Ethereum security and scam prevention – ethereum.org](https://ethereum.org/security/)

</details>

### Chemical Engineer (Core) (`chemical`)

Core engineering · branches CHEM · 8 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [GATE 2027 Chemical Engineering (CH) syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/CH_GATE2027_Syllabus.pdf)
- [DWSIM – A Chemical Process Simulator – FOSSEE](https://fossee.in/node/27)
- [IIChE Rules and Regulations](https://iiche.org.in/pdfs/RulesandRegulations.pdf)

<details><summary>All 15 cited links</summary>

- [Material & Energy Balance Computations – NPTEL (IIT Kharagpur)](https://onlinecourses.nptel.ac.in/noc21_ch50/preview)
- [Chemical Engineering Thermodynamics – NPTEL (IIT Tirupati)](https://onlinecourses.nptel.ac.in/noc24_ch31/preview)
- [DWSIM Brochure – Spoken Tutorial](https://website.spoken-tutorial.org/media/videos/78/DWSIM-Brochure-English.pdf)
- [DWSIM on FOSSEE (spoken tutorials link)](https://dwsim.fossee.in/node/10)
- [DWSIM Instruction Sheet – Spoken Tutorial](https://website.spoken-tutorial.org/media/videos/78/DWSIM-Instruction-Sheet-English.pdf)
- [Chemical Process Safety – NPTEL preview](https://onlinecourses.nptel.ac.in/noc20_ch38/preview)
- [Flowsheeting Project – DWSIM FOSSEE](https://dwsim.fossee.in/node/22)
- [Flowsheet proposal guidelines – DWSIM FOSSEE](https://dwsim.fossee.in/node/23)
- [IIT Madras announces GATE 2027 dates, syllabus revision and new paper](https://www.iitm.ac.in/happenings/press-releases-and-coverages/iit-madras-announces-dates-syllabus-revision-new-paper)
- [GAIL – Executive Trainee through GATE 2027 (advertisement)](https://www.gailonline.com/careers/currentOpnning/GATE-2027-1st-Advertisement-01092026.pdf)
- [GATE 2027 downloads (past papers) – IIT Madras](https://gate2027.iitm.ac.in/download)
- [Soft Skills – NPTEL (IIT Roorkee)](https://onlinecourses.nptel.ac.in/noc21_hs76/preview)

</details>

### Civil Engineer (Core) (`civil`)

Core engineering · branches CIVIL · 9 steps, 0 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [GATE 2027 Civil Engineering (CE) syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/CE_GATE2027_Syllabus.pdf)
- [The Institution of Engineers (India) – official website](https://www.ieindia.org/)
- [QGIS Training Manual](https://docs.qgis.org/3.44/en/docs/training_manual/index.html)

<details><summary>All 14 cited links</summary>

- [Autodesk Student Access to Education Downloads](https://www.autodesk.com/education/edu-software/overview)
- [Engineering Graphics and Design – NPTEL (IIT Delhi)](https://onlinecourses.nptel.ac.in/noc22_me68/preview)
- [FreeCAD Online Help Startpage](https://wiki.freecad.org/Online_Help_Startpage)
- [Structural Analysis I – NPTEL (IIT Kharagpur)](https://onlinecourses.nptel.ac.in/noc22_ce29/preview)
- [Reinforced Concrete Design – NPTEL (IIT Guwahati)](https://onlinecourses.nptel.ac.in/noc26_ce03/preview)
- [Principles of Construction Management – NPTEL (IIT Kanpur)](https://onlinecourses.nptel.ac.in/noc25_ce95/preview)
- [IIT Madras announces GATE 2027 dates, syllabus revision and new paper](https://www.iitm.ac.in/happenings/press-releases-and-coverages/iit-madras-announces-dates-syllabus-revision-new-paper)
- [Employment opportunities – POWERGRID](https://www.powergrid.in/en/job-opportunities1)
- [TGPSC notifications – Telangana Public Service Commission](https://websitenew.tgpsc.gov.in/notifications)
- [GATE 2027 downloads (past papers) – IIT Madras](https://gate2027.iitm.ac.in/download)
- [Soft Skills – NPTEL (IIT Roorkee)](https://onlinecourses.nptel.ac.in/noc21_hs76/preview)

</details>

### Cybersecurity Analyst (`cybersecurity`)

Security · branches CSE, IT, AIML, DS · 10 steps, 3 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Cyber Security Expert Roadmap – roadmap.sh](https://roadmap.sh/cyber-security)
- [Cyber Security Projects – roadmap.sh](https://roadmap.sh/cyber-security/projects)
- [The NIST Cybersecurity Framework (CSF) 2.0 – NIST](https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20)

<details><summary>All 20 cited links</summary>

- [Cyber Security Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/cyber-security.pdf)
- [Networking Basics – Cisco Networking Academy](https://www.netacad.com/courses/networking-basics?courseLang=en-US)
- [Wireshark User's Guide](https://www.wireshark.org/docs/wsug_html_chunked/)
- [OverTheWire: Bandit](https://overthewire.org/wargames/bandit/)
- [OverTheWire Wargames](https://overthewire.org/wargames/)
- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [NIST Releases Version 2.0 of Landmark Cybersecurity Framework](https://www.nist.gov/news-events/news/2024/02/nist-releases-version-20-landmark-cybersecurity-framework)
- [Introduction to Cybersecurity – Cisco Networking Academy (free)](https://www.netacad.com/courses/introduction-to-cybersecurity)
- [New learning paths, from the Web Security Academy – PortSwigger](https://portswigger.net/blog/new-learning-paths-from-the-web-security-academy)
- [OWASP Top 10](https://owasp.org/projects/top-ten)
- [Web Security Academy – PortSwigger (free)](https://portswigger.net/web-security)
- [Getting Started with picoCTF](https://picoctf.org/get_started.html)
- [picoCTF Learning Resources](https://picoctf.org/resources.html)
- [Configure SIEM security operations using Microsoft Sentinel – Microsoft Learn](https://learn.microsoft.com/en-us/training/paths/configure-security-information-event-management-operations-using-microsoft-sentinel/)
- [Describe the capabilities in Microsoft Sentinel – Microsoft Learn](https://learn.microsoft.com/en-us/training/modules/describe-security-capabilities-of-azure-sentinel/)
- [What Is on the CompTIA Security+ Exam? – CompTIA](https://www.comptia.org/en-us/blog/what-is-on-the-comptia-security-exam/)
- [What Is CompTIA Security+ Certification? – CompTIA](https://www.comptia.org/en-us/blog/what-is-comptia-security-certification/)

</details>

### Data Analyst (`data-analyst`)

Data and AI · branches CSE, IT, DS, AIML, OTHER · 9 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Data Analyst Roadmap – roadmap.sh](https://roadmap.sh/data-analyst)
- [How to Become a Data Analyst with No Experience – roadmap.sh](https://roadmap.sh/data-analyst/how-to-become)
- [Data Analyst Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/data-analyst.pdf)

<details><summary>All 16 cited links</summary>

- [CS50's Introduction to Databases with SQL – Harvard](https://cs50.harvard.edu/sql)
- [SQL Roadmap – roadmap.sh](https://roadmap.sh/sql)
- [OpenIntro Statistics (free PDF)](https://www.openintro.org/book/os/)
- [Python for Data Analysis – roadmap.sh](https://roadmap.sh/python-data-analysis)
- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [pandas Getting Started Tutorials](https://pandas.pydata.org/docs/getting_started/intro_tutorials/)
- [Kaggle Learn (free Python and pandas courses)](https://www.kaggle.com/learn)
- [Power BI Data Analyst learning catalog – Microsoft Learn](https://learn.microsoft.com/power-bi/learning-catalog/learning-catalog-data-analyst)
- [Data Analyst Projects – roadmap.sh](https://roadmap.sh/data-analyst/projects)
- [Learn Data Analysis with Python – freeCodeCamp](https://www.freecodecamp.org/news/learn-data-analysis-with-python-course/)
- [What Does a Data Analyst Do? – roadmap.sh](https://roadmap.sh/data-analyst/what-does-a-data-analyst-do)
- [50 Popular Data Analyst Interview Questions – roadmap.sh](https://roadmap.sh/questions/data-analyst)
- [30 SQL Queries Interview Questions and Answers – roadmap.sh](https://roadmap.sh/questions/sql-queries)

</details>

### Data Engineer (`data-engineer`)

Data and AI · branches CSE, IT, DS · 9 steps, 3 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Data Engineer Roadmap – roadmap.sh](https://roadmap.sh/data-engineer)
- [Data Engineering Zoomcamp – DataTalks.Club (GitHub)](https://github.com/datatalksclub/data-engineering-zoomcamp)

<details><summary>All 18 cited links</summary>

- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [Intro to Programming – Kaggle Learn](https://www.kaggle.com/learn/intro-to-programming)
- [CS50's Introduction to Databases with SQL – Harvard](https://cs50.harvard.edu/sql)
- [SQL Roadmap – roadmap.sh](https://roadmap.sh/sql)
- [Get started – Docker Docs](https://docs.docker.com/get-started/)
- [Core Concepts – Apache Airflow](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/index.html)
- [Airflow 101: Building Your First Workflow – Apache Airflow](https://airflow.apache.org/docs/apache-airflow/stable/tutorial/fundamentals.html)
- [What is dbt? – dbt Docs](https://docs.getdbt.com/docs/introduction)
- [Quickstart for dbt Core using DuckDB](https://docs.getdbt.com/guides/duckdb)
- [Quick Start – Apache Spark](https://spark.apache.org/docs/latest/quick-start.html)
- [Quickstart: DataFrame – PySpark](https://spark.apache.org/docs/latest/api/python/getting_started/quickstart_df.html)
- [Quickstart – Apache Kafka](https://kafka.apache.org/quickstart/)
- [Introduction – Apache Kafka](https://kafka.apache.org/intro/)
- [30 SQL Queries Interview Questions and Answers – roadmap.sh](https://roadmap.sh/questions/sql-queries)
- [Top 20 Python Interview Questions – roadmap.sh](https://roadmap.sh/questions/python)
- [Top 30 System Design Interview Questions – roadmap.sh](https://roadmap.sh/questions/system-design)

</details>

### Data Scientist (`data-science`)

Data and AI · branches CSE, IT, DS, AIML · 9 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [AI and Data Scientist Roadmap – roadmap.sh](https://roadmap.sh/ai-data-scientist)
- [AI and Data Scientist Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/ai-data-scientist.pdf)
- [Top Data Science Skills – roadmap.sh](https://roadmap.sh/ai-data-scientist/skills)

<details><summary>All 19 cited links</summary>

- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [pandas Getting Started Tutorials](https://pandas.pydata.org/docs/getting_started/intro_tutorials/)
- [Kaggle Learn (free Python and pandas courses)](https://www.kaggle.com/learn)
- [CS50's Introduction to Databases with SQL – Harvard](https://cs50.harvard.edu/sql)
- [SQL Roadmap – roadmap.sh](https://roadmap.sh/sql)
- [18.06 Linear Algebra – MIT OpenCourseWare](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/)
- [Data Science for Engineers – NPTEL (IIT Madras)](https://www.nptel.ac.in/courses/106106179)
- [OpenIntro Statistics (free PDF)](https://www.openintro.org/book/os/)
- [AI and Data Scientist Projects – roadmap.sh](https://roadmap.sh/ai-data-scientist/projects)
- [Top 60+ Data Science Interview Questions – roadmap.sh](https://roadmap.sh/questions/data-science)
- [Machine Learning Crash Course – Google for Developers](https://developers.google.com/machine-learning/crash-course)
- [Getting Started – scikit-learn](https://scikit-learn.org/stable/getting_started.html)
- [Introduction to Machine Learning – NPTEL (IIT Madras)](https://nptel.ac.in/courses/106106139)
- [Intro to Deep Learning – Kaggle Learn](https://www.kaggle.com/learn/intro-to-deep-learning)
- [Practical Deep Learning for Coders – fast.ai](https://course.fast.ai/)
- [30 SQL Queries Interview Questions and Answers – roadmap.sh](https://roadmap.sh/questions/sql-queries)

</details>

### DevOps and Cloud Engineer (`devops-cloud`)

Software · branches CSE, IT · 10 steps, 0 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [DevOps Roadmap – roadmap.sh](https://roadmap.sh/devops)
- [DevOps Beginner Roadmap – roadmap.sh](https://roadmap.sh/devops-beginner)
- [How to become a DevOps Engineer – roadmap.sh](https://roadmap.sh/devops/how-to-become-devops-engineer)
- [DevOps Engineer Skills – roadmap.sh](https://roadmap.sh/devops/skills)

<details><summary>All 24 cited links</summary>

- [Introduction to Linux (LFS101) – The Linux Foundation](https://training.linuxfoundation.org/training/introduction-to-linux/)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [Linux Roadmap – roadmap.sh](https://roadmap.sh/linux)
- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [Pro Git book – git-scm.com](https://www.git-scm.com/book/en/v2)
- [Computer Networks and Internet Protocol – NPTEL (IIT Kharagpur)](https://nptel.ac.in/courses/106105183)
- [Docker guides – Docker Docs](https://docs.docker.com/guides/)
- [Docker workshop overview – Docker Docs](https://docs.docker.com/get-started/workshop/)
- [Containerize an application – Docker Docs](https://docs.docker.com/guides/workshop/02_our_app)
- [Quickstart for GitHub Actions – GitHub Docs](https://docs.github.com/en/actions/get-started/quickstart)
- [AWS Cloud Practitioner training – AWS](https://aws.amazon.com/training/learn-about/cloud-practitioner/)
- [Introduction to Cloud Infrastructure: Apply Azure Skills in Guided Projects – Microsoft Learn](https://learn.microsoft.com/en-us/training/paths/introduction-cloud-infrastructure-apply-azure-skills-guided-projects/)
- [Cloud Computing – NPTEL (IIT Kharagpur)](https://nptel.ac.in/courses/106105167)
- [Get Started – AWS (Terraform tutorials) – HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/aws-get-started)
- [Top DevOps Interview Questions – roadmap.sh](https://roadmap.sh/questions/devops)
- [Learn Kubernetes Basics – kubernetes.io](https://www.kubernetes.io/docs/tutorials/kubernetes-basics/)
- [First steps with Prometheus – prometheus.io](https://prometheus.io/docs/introduction/first_steps/)
- [Get started with Grafana and Prometheus – Grafana Docs](https://grafana.com/docs/grafana/latest/fundamentals/getting-started/first-dashboards/get-started-grafana-prometheus/)
- [System Design Interview Questions – roadmap.sh](https://roadmap.sh/questions/system-design)
- [AWS Certified Cloud Practitioner – AWS](https://aws.amazon.com/certification/certified-cloud-practitioner/)

</details>

### Electronics and Communication Engineering Careers (VLSI, communication, core) (`ece`)

Core engineering · branches ECE · 10 steps, 6 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [GATE 2027 EC syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/EC_GATE2027_Syllabus.pdf)
- [GATE 2027 test papers and syllabus – IIT Madras](https://gate2027.iitm.ac.in/exam_papers_and_syllabus)
- [VLSI Design Flow: RTL to GDS – NPTEL](https://onlinecourses.nptel.ac.in/noc23_ee137/preview)
- [NPTEL Communication and Signal Processing domain](https://nptel.ac.in/domains/discipline/112?course=112_1)

<details><summary>All 29 cited links</summary>

- [Digital Circuits – NPTEL](https://onlinecourses.nptel.ac.in/noc24_ee147/preview)
- [ngspice tutorials (free SPICE simulator)](https://ngspice.sourceforge.io/tutorials.html)
- [Hardware Modeling using Verilog – NPTEL](https://onlinecourses.nptel.ac.in/noc20_cs63/preview)
- [Hardware Modeling using Verilog – NPTEL (IIT Kharagpur)](https://onlinecourses.nptel.ac.in/e-learning/preview/noc25_cs155)
- [Digital Design with Verilog – NPTEL](https://onlinecourses.nptel.ac.in/noc26_cs24/preview)
- [Verilator User's Guide (free Verilog simulator)](https://verilator.org/guide/latest/)
- [Digital IC Design – NPTEL (IIT Madras)](https://onlinecourses.nptel.ac.in/noc25_ee21/preview)
- [OpenROAD documentation](https://openroad.readthedocs.io/)
- [CMOS Digital VLSI Design – NPTEL](https://onlinecourses.nptel.ac.in/noc26_ee85/preview)
- [Principles of Digital Communication – NPTEL](https://onlinecourses.nptel.ac.in/noc26_ee25/preview)
- [Signal Processing Onramp – MathWorks (free)](https://matlabacademy.mathworks.com/details/signal-processing-onramp/signalprocessing)
- [Guided Tutorial GRC – GNU Radio](https://wiki.gnuradio.org/index.php/Guided_Tutorial_GRC)
- [OpenROAD Flow Scripts documentation](https://openroad-flow-scripts.readthedocs.io/en/latest/index2.html)
- [MATLAB Onramp – MathWorks (free)](https://matlabacademy.mathworks.com/details/matlab-onramp/gettingstarted)
- [ngspice documentation](https://ngspice.sourceforge.io/docs.html)
- [Your First Flowgraph – GNU Radio](https://wiki.gnuradio.org/index.php?title=Your_First_Flowgraph)
- [GATE 2027 – IIT Madras (organising institute)](https://gate2027.iitm.ac.in/)
- [IIT Madras announces GATE 2027 dates and syllabus revision](https://www.iitm.ac.in/happenings/press-releases-and-coverages/iit-madras-announces-dates-syllabus-revision-new-paper)
- [ISRO Careers](https://www.isro.gov.in/Careers.html)
- [BEL Job Notifications](https://bel-india.in/job-notifications/)
- [Engineering Services (Preliminary) Examination 2027 – UPSC](<https://www.upsc.gov.in/whats-new/Engineering%20Services%20(Preliminary)%20Examination,%202027/Exam%20Notification>)
- [GATE 2027 eligibility criteria – IIT Madras](https://gate2027.iitm.ac.in/eligibility_criteria)
- [GATE 2027 FAQs – IIT Madras](https://gate2027.iitm.ac.in/faqs)
- [ISRO Current Opportunities](https://www.isro.gov.in/CurrentOpportunities.html)
- [GATE 2027 CS syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/CS_GATE2027_Syllabus.pdf)

</details>

### Electrical and Electronics Engineering Careers (power, control, core) (`eee`)

Core engineering · branches EEE · 10 steps, 7 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [GATE 2027 EE syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/EE_GATE2027_Syllabus.pdf)
- [GATE 2027 test papers and syllabus – IIT Madras](https://gate2027.iitm.ac.in/exam_papers_and_syllabus)
- [Power Systems Simulation Onramp – MathWorks](https://matlabacademy.mathworks.com/details/power-systems-simulation-onramp/orps)

<details><summary>All 18 cited links</summary>

- [ngspice tutorials (free SPICE simulator)](https://ngspice.sourceforge.io/tutorials.html)
- [Digital Circuits – NPTEL](https://onlinecourses.nptel.ac.in/noc24_ee147/preview)
- [Simulink online courses – MathWorks](https://www.mathworks.com/help/simulink/slref/simulinkonlinecourses.html)
- [MATLAB Onramp – MathWorks (free)](https://matlabacademy.mathworks.com/details/matlab-onramp/gettingstarted)
- [ngspice documentation](https://ngspice.sourceforge.io/docs.html)
- [MATLAB & Simulink self-paced courses – MathWorks](https://matlabacademy.mathworks.com/)
- [ngspice (free circuit simulator)](https://ngspice.sourceforge.io/)
- [GATE 2027 – IIT Madras (organising institute)](https://gate2027.iitm.ac.in/)
- [IIT Madras announces GATE 2027 dates and syllabus revision](https://www.iitm.ac.in/happenings/press-releases-and-coverages/iit-madras-announces-dates-syllabus-revision-new-paper)
- [UPSC Examination Notifications](https://upsc.gov.in/exams-related-info/exam-notification/archives)
- [Engineering Services (Preliminary) Examination 2027 – UPSC](<https://www.upsc.gov.in/whats-new/Engineering%20Services%20(Preliminary)%20Examination,%202027/Exam%20Notification>)
- [GATE 2027 eligibility criteria – IIT Madras](https://gate2027.iitm.ac.in/eligibility_criteria)
- [GATE 2027 FAQs – IIT Madras](https://gate2027.iitm.ac.in/faqs)
- [BEL Job Notifications](https://bel-india.in/job-notifications/)
- [GATE 2027 CS syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/CS_GATE2027_Syllabus.pdf)

</details>

### Embedded Systems and IoT Engineer (`embedded-iot`)

Core engineering · branches ECE, EEE, CSE · 10 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Introduction to Embedded System Design – NPTEL](https://onlinecourses.nptel.ac.in/noc26_cs22/preview)
- [ESP-IDF Programming Guide (stable) – Espressif](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/index.html)
- [FreeRTOS documentation](https://www.freertos.org/Documentation/00-Overview)
- [Embedded Linux training materials – Bootlin](https://bootlin.com/doc/training/embedded-linux/)

<details><summary>All 29 cited links</summary>

- [C++ vs. C: when to use each – roadmap.sh](https://roadmap.sh/cpp/vs-c)
- [BARR-C:2018 Embedded C Coding Standard](https://barrgroup.com/embedded-c-coding-standard)
- [Problem Solving through Programming in C – NPTEL (IIT Kharagpur)](https://nptel.ac.in/courses/106105171)
- [Built-in Examples – Arduino Docs](https://docs.arduino.cc/built-in-examples/)
- [The C/C++ SDK – Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/microcontrollers/c_sdk.html)
- [Getting Started with Arduino – Arduino Docs](https://docs.arduino.cc/learn/starting-guide/getting-started-arduino/)
- [Exception handling and prioritization – Arm Cortex-M4 TRM](https://developer.arm.com/documentation/100166/0001/Programmers-Model/Exceptions/Exception-handling-and-prioritization)
- [Embedded System Design with ARM – NPTEL](https://onlinecourses.nptel.ac.in/noc26_cs40/preview)
- [Cortex-M0+ Devices Generic User Guide – Arm](https://developer.arm.com/documentation/dui0662/b/BABEDCBC)
- [UM10204 I2C-bus specification and user manual – NXP](https://www.nxp.com/docs/en/user-guide/UM10204.pdf)
- [Serial Peripheral Interface (SPI) – Linux kernel docs](https://docs.kernel.org/driver-api/spi.html)
- [ESP-IDF versions – which docs to use](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/versions.html)
- [FreeRTOS tasks overview](https://freertos.org/Documentation/02-Kernel/02-Kernel-features/01-Tasks-and-co-routines/01-Tasks-overview)
- [Mastering the FreeRTOS Real Time Kernel (free PDF)](https://www.freertos.org/media/2018/161204_Mastering_the_FreeRTOS_Real_Time_Kernel-A_Hands-On_Tutorial_Guide.pdf)
- [FreeRTOS queues](https://freertos.org/Documentation/02-Kernel/02-Kernel-features/02-Queues-mutexes-and-semaphores/01-Queues)
- [MQTT Version 3.1.1 – OASIS Standard](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html)
- [mosquitto broker man page](https://mosquitto.org/man/mosquitto-8.html)
- [MQTT specification – mqtt.org](https://mqtt.org/mqtt-specification/)
- [mosquitto_sub man page](https://mosquitto.org/man/mosquitto_sub-1.html)
- [SPI userspace API (spidev) – Linux kernel docs](https://www.kernel.org/doc/html/latest/spi/spidev.html)
- [Raspberry Pi computer hardware – Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html)
- [Yocto Project Quick Build](https://docs.yoctoproject.org/brief-yoctoprojectqs/index.html)
- [Networking APIs – ESP-IDF Programming Guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/network/index.html)
- [Embedded Systems Design – NPTEL (IIT Kharagpur)](https://onlinecourses.nptel.ac.in/noc26_cs54/preview)
- [Employment Communication: A Lab-based Course – NPTEL](https://onlinecourses.nptel.ac.in/noc25_hs17/preview)

</details>

### Forward Deployed Engineer (`forward-deployed-engineer`)

Software · branches CSE, IT, DS · 9 steps, 4 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [A Day in the Life of a Palantir Forward Deployed Software Engineer – Palantir Blog](https://blog.palantir.com/a-day-in-the-life-of-a-palantir-forward-deployed-software-engineer-45ef2de257b1)
- [Dev versus Delta: Demystifying engineering roles at Palantir – Palantir Blog](https://blog.palantir.com/dev-versus-delta-demystifying-engineering-roles-at-palantir-ad44c2a6e87)
- [Full Stack Developer Roadmap – roadmap.sh](https://roadmap.sh/full-stack)

<details><summary>All 19 cited links</summary>

- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [PostgreSQL Tutorial (Part I)](https://www.postgresql.org/docs/current/tutorial.html)
- [PostgreSQL Tutorial – The SQL Language](https://www.postgresql.org/docs/current/tutorial-sql.html)
- [Getting started – pandas documentation](https://pandas.pydata.org/docs/getting_started/index.html)
- [10 minutes to pandas](https://pandas.pydata.org/docs/user_guide/10min.html)
- [JavaScript Guide – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)
- [Learn web development – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Learn_web_development)
- [How to Become a Full Stack Developer – roadmap.sh](https://roadmap.sh/full-stack/how-to-become)
- [Get started – Docker Docs](https://docs.docker.com/get-started/)
- [Overview of the Docker workshop – Docker Docs](https://docs.docker.com/guides/get-started/)
- [AI Engineer Roadmap – roadmap.sh](https://roadmap.sh/ai-engineer)
- [AI Engineer Projects – roadmap.sh](https://roadmap.sh/ai-engineer/projects)
- [Build and share a containerized application – Docker Docs](https://docs.docker.com/get-started/introduction/)
- [Interviewing at Palantir: Our advice – Palantir Blog](https://blog.palantir.com/interviewing-at-palantir-advice-from-palantirians-88444a90e7c4)
- [System Design Interview Questions – roadmap.sh](https://roadmap.sh/questions/system-design)
- [Full Stack Developer Interview Questions – roadmap.sh](https://roadmap.sh/questions/full-stack)

</details>

### Frontend Developer (`frontend`)

Software · branches CSE, IT · 10 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Frontend Developer Roadmap – roadmap.sh](https://roadmap.sh/frontend)
- [12 In-Demand Front End Developer Skills – roadmap.sh](https://roadmap.sh/frontend/developer-skills)
- [MDN Curriculum](https://developer.mozilla.org/en-US/curriculum/)
- [Full Stack JavaScript Path – The Odin Project](https://theodinproject.com/paths/2)

<details><summary>All 23 cited links</summary>

- [How the web works – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works)
- [Learn web development – MDN](https://developer.mozilla.org/en-US/docs/Learn)
- [HTML Roadmap – roadmap.sh](https://roadmap.sh/html)
- [Responsive Web Design certification redesigned – freeCodeCamp](https://www.freecodecamp.org/news/responsive-web-design-certification-redesigned/)
- [CSS Roadmap – roadmap.sh](https://roadmap.sh/css)
- [freeCodeCamp's Responsive Web Design certification](https://www.freecodecamp.org/news/freecodecamps-new-responsive-web-design-certification-is-now-live/)
- [JavaScript lecture – CS50's Web Programming](https://cs50.harvard.edu/web/notes/5/)
- [Pro Git (free book)](https://git-scm.com/book/en/v2)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [CS50's Web Programming with Python and JavaScript](https://cs50.harvard.edu/web/)
- [Overview of HTTP – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [What You Can Do to Prepare – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-you-can-do-to-prepare)
- [JavaScript Projects – roadmap.sh](https://roadmap.sh/javascript/projects)
- [Project 0 – CS50's Web Programming](https://cs50.harvard.edu/web/projects/0/)
- [How to Become a Front-End Developer in 7 Steps – roadmap.sh](https://roadmap.sh/frontend/how-to-become-frontend-developer)
- [Strategy – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-strategy)
- [Frontend Developer Job Description – roadmap.sh](https://roadmap.sh/frontend/job-description)
- [Preparing to Interview and Interviewing – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-preparing-to-interview-and-interviewing)
- [Applying for Web Development Jobs – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-applying-for-web-development-jobs)

</details>

### Game Developer (`game-dev`)

Software · branches CSE, IT · 9 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Game Developer Roadmap – roadmap.sh](https://roadmap.sh/game-developer)
- [Game Developer Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/game-developer.pdf)
- [Unity Learn Pathways](https://learn.unity.com/pathways)

<details><summary>All 19 cited links</summary>

- [Get started with C#, Part 1 – Microsoft Learn](https://learn.microsoft.com/en-us/training/paths/get-started-c-sharp-part-1/)
- [C# Guide – Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/)
- [18.06 Linear Algebra – MIT OpenCourseWare](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/)
- [Coordinate Systems – LearnOpenGL](https://learnopengl.com/Getting-started/Coordinate-Systems)
- [Unity Essentials Pathway – Unity Learn](https://learn.unity.com/pathway/unity-essentials)
- [Step by step – Godot Docs](https://docs.godotengine.org/en/stable/getting_started/step_by_step/index.html)
- [Your first 2D game – Godot Docs](https://docs.godotengine.org/en/stable/getting_started/first_2d_game/index.html)
- [CS50's Introduction to 2D Game Development](https://cs50.harvard.edu/games/)
- [Game Programming Patterns](https://gameprogrammingpatterns.com/)
- [Component – Game Programming Patterns](https://gameprogrammingpatterns.com/component.html)
- [LearnOpenGL – OpenGL](https://learnopengl.com/Getting-started/OpenGL)
- [LearnOpenGL](https://learnopengl.com/)
- [Hello Triangle – LearnOpenGL](https://learnopengl.com/Getting-started/Hello-Triangle)
- [Shaders – LearnOpenGL](https://learnopengl.com/Getting-started/Shaders)
- [Game jams – itch.io](https://itch.io/jams)
- [Upcoming Game Jams – itch.io](https://itch.io/jams/upcoming)

</details>

### Government Engineering Jobs: ESE, SSC JE, TGPSC and PSUs (`govt-exams`)

Exams and higher studies · branches CSE, IT, ECE, EEE, MECH, CIVIL, CHEM, AIML, DS · 10 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Engineering Services Examination 2027 notice – UPSC](https://www.upsc.gov.in/sites/default/files/Notif-ESEP-2027-Engl-160926.pdf)
- [Junior Engineer Examination notice – SSC](https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/notice_16092026.pdf)
- [Telangana Public Service Commission (TGPSC)](https://websitenew.tgpsc.gov.in/)
- [Recruitment system in NTPC](https://ntpc.co.in/recruitment-system-ntpc)

<details><summary>All 21 cited links</summary>

- [Engineer Trainee 2027 through GATE 2027 – POWERGRID](https://www.powergrid.in/sites/default/files/job_opportunities_document/ET2027_Detailed_Advertisement_For%20Website_1.pdf)
- [SSC tentative exam calendar 2026–27](https://ssc.gov.in/api/attachment/uploads/masterData/ExamCalendar/Tentative_Calendar2026_27_08012026.pdf)
- [GATE 2027 important dates](https://gate2027.iitm.ac.in/important_dates)
- [TGPSC notifications](https://websitenew.tgpsc.gov.in/notifications)
- [GATE 2027 test papers and syllabus – IIT Madras](https://gate2027.iitm.ac.in/exam_papers_and_syllabus)
- [Engineering Mathematics – I – NPTEL](https://onlinecourses.nptel.ac.in/noc21_ma58/preview)
- [Previous year question papers – UPSC](https://www.upsc.gov.in/examinations/previous-question-papers)
- [Downloads – GATE 2027, IIT Madras](https://gate2027.iitm.ac.in/download)
- [Previous year question papers (filter: Engineering Services) – UPSC](https://upsc.gov.in/examinations/previous-question-papers?field_exam_name_value=engineering+services&page=1)
- [Recruitment notices – ONGC](https://ongcindia.com/web/eng/career/recruitment-notice)
- [Jobs at NTPC](https://ntpc.co.in/jobs-ntpc)
- [Employment opportunities – POWERGRID](https://www.powergrid.in/en/job-opportunities1)
- [Latest job openings – IndianOil](https://iocl.com/latest-job-opening)
- [Engineering Services (Main) Examination 2026 papers – UPSC](<https://www.upsc.gov.in/examinations/Engineering%20Services%20(Main)%20Examination,%202026>)
- [Tentative vacancy – SSC](https://ssc.gov.in/for-candidates/tentative-vacancy)
- [Soft Skills – NPTEL (IIT Roorkee)](https://onlinecourses.nptel.ac.in/noc21_hs76/preview)
- [Employment Communication: A Lab-based Course – NPTEL](https://onlinecourses.nptel.ac.in/noc25_hs17/preview)

</details>

### Higher Studies: GATE, M.Tech, MS Abroad and Research (`higher-studies`)

Exams and higher studies · branches CSE, IT, ECE, EEE, MECH, CIVIL, CHEM, AIML, DS · 10 steps, 0 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [GATE 2027 – IIT Madras (organising institute)](https://gate2027.iitm.ac.in/)
- [COAP 2026 – Common Offer Acceptance Portal, IIT Roorkee](https://coap2026.iitr.ac.in/coap2026/)
- [CCMT – Centralized Counselling for M.Tech/M.Arch/M.Plan](https://ccmt.admissions.nic.in/)
- [About the GRE General Test – ETS](https://www.ets.org/gre/test-takers/general-test/about.html)
- [Graduate study – EducationUSA (U.S. Department of State)](https://educationusa.state.gov/your-5-steps-us-study/research-your-options/graduate)

<details><summary>All 32 cited links</summary>

- [GATE 2027 eligibility criteria – IIT Madras](https://gate2027.iitm.ac.in/eligibility_criteria)
- [Ph.D. programmes – IIT Hyderabad](https://iith.ac.in/academics/phd/)
- [GATE 2027 test papers and syllabus – IIT Madras](https://gate2027.iitm.ac.in/exam_papers_and_syllabus)
- [IIT Madras press release on GATE 2027 syllabus revision](https://www.iitm.ac.in/happenings/press-releases-and-coverages/iit-madras-announces-dates-syllabus-revision-new-paper)
- [GATE 2027 Data Science and AI (DA) syllabus](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/DA_GATE2027_Syllabus.pdf)
- [Engineering Mathematics – I – NPTEL](https://onlinecourses.nptel.ac.in/noc21_ma58/preview)
- [Advanced Engineering Mathematics – NPTEL](https://onlinecourses.nptel.ac.in/noc21_ma57/preview)
- [Foundations of Mathematics courses – NPTEL](https://nptel.ac.in/domains/discipline/116?course=116_0)
- [Downloads – GATE 2027, IIT Madras](https://gate2027.iitm.ac.in/download)
- [Sample and previous question papers – GATE 2026, IIT Guwahati](https://gate2026.iitg.ac.in/download.html)
- [Mock test links – GATE 2025, IIT Roorkee](https://gate2025.iitr.ac.in/mock-test-links.html)
- [GATE 2027 FAQs](https://gate2027.iitm.ac.in/faqs)
- [GATE 2027 notifications](https://gate2027.iitm.ac.in/notifications)
- [COAP 2026 FAQs – IIT Roorkee](https://coap2026.iitr.ac.in/coap2026/faqs.php)
- [About CCMT](https://ccmt.admissions.nic.in/about-department/)
- [CCMT opening and closing scores](https://ccmt.admissions.nic.in/or-cr/)
- [TOEFL iBT test preparation – ETS](https://www.ets.org/toefl/test-takers/ibt/prepare.html)
- [GRE General Test content – ETS](https://www.ets.org/gre/test-takers/general-test/prepare/content.html)
- [Free IELTS practice and sample tests – British Council](https://takeielts.britishcouncil.org/prepare/ielts-free-practice-mock-tests)
- [Finance your studies: graduate – EducationUSA](https://educationusa.state.gov/your-5-steps-us-study/finance-your-studies/graduate)
- [Research and narrow your options: graduate – EducationUSA](https://educationusa.state.gov/your-5-steps-us-study/research-your-options/graduate/research-and-narrow-your-options-graduate)
- [PMRF guidelines](https://pmrf.in/guidelines-new.html)
- [Research Methodology – NPTEL (IIT Madras)](https://onlinecourses.nptel.ac.in/noc23_ge36/preview)
- [Prime Minister's Research Fellowship (PMRF)](https://pmrf.in/)
- [PG Scholarship Scheme – AICTE](https://www.aicte.gov.in/schemes/students-development-schemes/PG-Scholarship-Scheme)
- [National Overseas Scholarship – Ministry of Social Justice](https://socialjustice.gov.in/schemes/28)
- [Overseas scholarships – Telangana ePASS](https://telanganaepass.cgg.gov.in/OverseasLinks.do)

</details>

### Mechanical Engineer (Core) (`mechanical`)

Core engineering · branches MECH · 8 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [GATE 2027 Mechanical Engineering (ME) syllabus – IIT Madras](https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/ME_GATE2027_Syllabus.pdf)
- [Engineering Graphics and Design – NPTEL (IIT Delhi)](https://onlinecourses.nptel.ac.in/noc22_me68/preview)
- [Student Membership – ASME](https://asme.org/membership/student-membership)

<details><summary>All 17 cited links</summary>

- [Autodesk Fusion for education](https://www.autodesk.com/in/education/edu-software/fusion)
- [FreeCAD Online Help Startpage](https://wiki.freecad.org/Online_Help_Startpage)
- [Manufacturing Process Technology I & II – NPTEL (IIT Kanpur)](https://onlinecourses.nptel.ac.in/noc25_me51/preview)
- [Thermodynamics – NPTEL (Prof. S. R. Kale, IIT Delhi)](https://onlinecourses.nptel.ac.in/noc25_me78/preview)
- [Ansys Student – free download](https://www.ansys.com/academic/students/ansys-student)
- [Finite Element Method – NPTEL (IIT Kharagpur)](https://onlinecourses.nptel.ac.in/noc25_ce21/preview)
- [Fundamentals of Finite Element (FE) Method – Ansys Innovation Space](https://innovationspace.ansys.com/product/fundamentals-of-finite-element-fe-method/)
- [BAJA SAEINDIA press release (official)](https://bajasaeindia.org/upload/Pressrelease/Press%20Release%20Preliminary%20BAJA%20SAEINDIA%202024_1690821286.pdf)
- [IIT Madras announces GATE 2027 dates, syllabus revision and new paper](https://www.iitm.ac.in/happenings/press-releases-and-coverages/iit-madras-announces-dates-syllabus-revision-new-paper)
- [Recruitment System in NTPC](https://ntpc.co.in/recruitment-system-ntpc)
- [NTPC careers portal](https://careers.ntpc.co.in/)
- [GATE 2027 downloads (past papers, brochure) – IIT Madras](https://gate2027.iitm.ac.in/download)
- [CS50x: Introduction to Computer Science – Harvard](https://cs50.harvard.edu/x/)
- [Soft Skills – NPTEL (IIT Roorkee)](https://onlinecourses.nptel.ac.in/noc21_hs76/preview)

</details>

### Machine Learning and AI Engineer (`ml-ai-engineer`)

Data and AI · branches CSE, AIML, DS, IT · 9 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Machine Learning Engineer Roadmap – roadmap.sh](https://roadmap.sh/machine-learning)
- [AI Engineer Roadmap – roadmap.sh](https://roadmap.sh/ai-engineer)
- [MLOps Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/mlops.pdf)

<details><summary>All 26 cited links</summary>

- [Machine Learning Crash Course: Prerequisites and prework – Google](https://developers.google.com/machine-learning/crash-course/prereqs-and-prework)
- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [Intro to Programming – Kaggle Learn](https://www.kaggle.com/learn/intro-to-programming)
- [pandas Getting Started Tutorials](https://pandas.pydata.org/docs/getting_started/intro_tutorials/)
- [18.06 Linear Algebra – MIT OpenCourseWare](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/)
- [OpenIntro Statistics (free PDF)](https://www.openintro.org/book/os/)
- [Machine Learning Crash Course – Google for Developers](https://developers.google.com/machine-learning/crash-course)
- [Datasets, generalization, and overfitting – Google MLCC](https://developers.google.com/machine-learning/crash-course/overfitting)
- [Getting Started – scikit-learn](https://scikit-learn.org/stable/getting_started.html)
- [Introduction to Machine Learning – NPTEL (IIT Madras)](https://nptel.ac.in/courses/106106139)
- [Learn the Basics – PyTorch Tutorials](https://docs.pytorch.org/tutorials/beginner/basics/intro.html)
- [Practical Deep Learning for Coders – fast.ai](https://course.fast.ai/)
- [Intro to Deep Learning – Kaggle Learn](https://www.kaggle.com/learn/intro-to-deep-learning)
- [LLM Course – Hugging Face](https://huggingface.co/learn/llm-course/en/chapter1/1)
- [Introduction to Large Language Models – Google MLCC](https://developers.google.com/machine-learning/crash-course/llm)
- [AI Agents Course – Hugging Face](https://huggingface.co/learn/agents-course/unit0/introduction)
- [Get started – Docker Docs](https://docs.docker.com/get-started/)
- [Production ML systems – Google MLCC](https://developers.google.com/machine-learning/crash-course/production-ml-systems)
- [AI Engineer Projects – roadmap.sh](https://roadmap.sh/ai-engineer/projects)
- [AI and Data Scientist Projects – roadmap.sh](https://roadmap.sh/ai-data-scientist/projects)
- [Top 60+ Data Science Interview Questions – roadmap.sh](https://roadmap.sh/questions/data-science)
- [Top 20 Python Interview Questions – roadmap.sh](https://roadmap.sh/questions/python)
- [Top 30 System Design Interview Questions – roadmap.sh](https://roadmap.sh/questions/system-design)

</details>

### Mobile App Developer (Android / Flutter) (`mobile`)

Software · branches CSE, IT, ECE · 9 steps, 6 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Android Developer Roadmap – roadmap.sh](https://roadmap.sh/android)
- [Flutter Developer Roadmap – roadmap.sh](https://roadmap.sh/flutter)
- [Mobile Application Security Cheat Sheet – OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html)

<details><summary>All 15 cited links</summary>

- [Learn Java – Dev.java](https://dev.java/learn/)
- [Java Language Basics – Dev.java](https://dev.java/learn/language-basics/)
- [CS50x 2026](https://cs50.harvard.edu/x/)
- [Pro Git (free book)](https://git-scm.com/book/en/v2)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [Overview of HTTP – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [API Design Roadmap – roadmap.sh](https://roadmap.sh/api-design)
- [What You Can Do to Prepare – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-you-can-do-to-prepare)
- [What Companies Want – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-companies-want)
- [Strategy – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-strategy)
- [Preparing to Interview and Interviewing – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-preparing-to-interview-and-interviewing)
- [CSES Problem Set](https://cses.fi/)

</details>

### Product Manager (technical roles) (`product-management`)

Design and product · branches CSE, IT, ECE, EEE, MECH, OTHER · 10 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Product Manager Roadmap – roadmap.sh](https://roadmap.sh/product-manager)
- [Product Management – Atlassian Agile Coach](https://www.atlassian.com/agile/product-management)
- [Product Manager: Role & Best Practices – Atlassian](https://www.atlassian.com/agile/product-management/product-manager)

<details><summary>All 27 cited links</summary>

- [Product manager vs. project manager – Atlassian](https://www.atlassian.com/agile/project-management/product-vs-project-management)
- [CS50x: Introduction to Computer Science – Harvard](https://cs50.harvard.edu/x/)
- [How does the Internet work? – MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/How_does_the_Internet_work)
- [Overview of HTTP – MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [User Interviews 101 – NN/G](https://www.nngroup.com/articles/user-interviews/)
- [Stakeholder Interviews 101 – NN/G](https://www.nngroup.com/articles/stakeholder-interviews/)
- [What is a Product Requirements Document (PRD)? – Atlassian](https://www.atlassian.com/agile/product-management/requirements)
- [User Stories with Examples and a Template – Atlassian](https://www.atlassian.com/agile/project-management/user-stories)
- [What is Acceptance Criteria? – Atlassian](https://www.atlassian.com/work-management/project-management/acceptance-criteria)
- [The Scrum Guide – ScrumGuides.org](https://scrumguides.org/)
- [What is Scrum? – Atlassian](https://www.atlassian.com/agile/scrum)
- [Product backlog: tips for creation and prioritization – Atlassian](https://www.atlassian.com/agile/scrum/backlogs)
- [Prioritization frameworks – Atlassian](https://www.atlassian.com/agile/product-management/prioritization-framework)
- [Prioritizing ideas – Jira Product Discovery handbook](https://www.atlassian.com/software/jira/product-discovery/resources/handbook/prioritization)
- [Outcomes vs Outputs – Jira Product Discovery handbook](https://www.atlassian.com/software/jira/product-discovery/resources/handbook/outcomes)
- [Intro to SQL: Querying and managing data – Khan Academy](https://en.khanacademy.org/computing/sql)
- [OKRs: The Ultimate Guide – Atlassian](https://www.atlassian.com/agile/agile-at-scale/okr)
- [GA4 Analytics Academy – Google Analytics Help](https://support.google.com/analytics/answer/15440208)
- [Usability (User) Testing 101 – NN/G](https://www.nngroup.com/articles/usability-testing-101/)
- [10 Usability Heuristics for User Interface Design – NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Free Product Requirements Document template – Atlassian](https://www.atlassian.com/software/confluence/templates/product-requirements)
- [CS50's Web Programming with Python and JavaScript – Harvard](https://cs50.harvard.edu/web/)
- [A day with Atlassian's Associate Product Managers](https://www.atlassian.com/company/careers/resources/culture/a-day-with-atlassians-apms)
- [How to think like a Product Manager – Inside Atlassian](https://www.atlassian.com/blog/developer/how-to-think-like-a-product-manager)

</details>

### QA, Testing and SDET (`qa-sdet`)

Software · branches CSE, IT, ECE · 9 steps, 2 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [QA Roadmap – roadmap.sh](https://roadmap.sh/qa)
- [Certified Tester Foundation Level (CTFL) v4.0 – ISTQB](https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/)
- [QA Projects – roadmap.sh](https://roadmap.sh/qa/projects)

<details><summary>All 15 cited links</summary>

- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [Pro Git book – git-scm.com](https://www.git-scm.com/book/en/v2)
- [Get Started – pytest documentation](https://docs.pytest.org/en/stable/getting-started.html)
- [Write scripts to test API response data – Postman Docs](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts)
- [Postman test script examples – Postman Docs](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-examples)
- [Test end-to-end API workflows – Postman Docs](https://learning.postman.com/docs/tests-and-scripts/test-apis/end-to-end-testing)
- [The Selenium Browser Automation Project – selenium.dev](https://www.selenium.dev/documentation/)
- [Playwright installation and first test – playwright.dev](https://playwright.dev/docs/intro)
- [Playwright for Python – playwright.dev](https://playwright.dev/python/docs/intro)
- [Write your first Selenium script – selenium.dev](https://www.selenium.dev/documentation/webdriver/getting_started/first_script/)
- [Quickstart for GitHub Actions – GitHub Docs](https://docs.github.com/en/actions/get-started/quickstart)
- [CTFL v4.0 Sample Exam A – ISTQB (PDF)](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_v4.0_Sample-Exam-A-Questions_v1.6.pdf)

</details>

### Software Engineer (DSA and interviews) (`sde-dsa`)

Software · branches CSE, IT, AIML, DS · 10 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Data Structures & Algorithms Roadmap – roadmap.sh](https://roadmap.sh/datastructures-and-algorithms)
- [6.006 Introduction to Algorithms (Spring 2020) – MIT OpenCourseWare](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/)
- [Programming, Data Structures and Algorithms Using Python – NPTEL](https://nptel.ac.in/courses/106106145)
- [Preparing to Interview and Interviewing – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-preparing-to-interview-and-interviewing)

<details><summary>All 22 cited links</summary>

- [CS50x 2026](https://cs50.harvard.edu/x/)
- [CS50's Introduction to Programming with Python](https://cs50.harvard.edu/python/)
- [Learn Java – Dev.java](https://dev.java/learn/)
- [The Python Tutorial](https://docs.python.org/3/tutorial/index.html)
- [Data Structures & Algorithms Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/datastructures-and-algorithms.pdf)
- [6.006 Syllabus – MIT OpenCourseWare](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/syllabus/)
- [6.006 Lecture Notes – MIT OpenCourseWare](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/)
- [Design and Analysis of Algorithms – NPTEL](https://nptel.ac.in/courses/106106131)
- [CSES Problem Set](https://cses.fi/)
- [Computer Science Roadmap (PDF) – roadmap.sh](https://roadmap.sh/pdfs/roadmaps/computer-science.pdf)
- [CS50's Introduction to Databases with SQL (archived, free to view)](https://cs50.harvard.edu/sql/)
- [Overview of HTTP – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [What You Can Do to Prepare – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-you-can-do-to-prepare)
- [20 Backend Project Ideas – roadmap.sh](https://roadmap.sh/backend/project-ideas)
- [Pro Git (free book)](https://git-scm.com/book/en/v2)
- [What Companies Want – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-companies-want)
- [Strategy – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-strategy)

</details>

### Site Reliability Engineer (`sre`)

Software · branches CSE, IT · 9 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Site Reliability Engineering books (free to read online) – Google SRE](https://sre.google/books/)
- [Site Reliability Engineering: table of contents – Google SRE](https://sre.google/sre-book/table-of-contents/)
- [DevOps Roadmap: Learn to become a DevOps Engineer or SRE – roadmap.sh](https://roadmap.sh/devops)

<details><summary>All 30 cited links</summary>

- [Introduction to Linux (LFS101) – The Linux Foundation](https://training.linuxfoundation.org/training/introduction-to-linux/)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [Linux Roadmap – roadmap.sh](https://roadmap.sh/linux)
- [SRE book: Introduction – Google SRE](https://sre.google/sre-book/introduction/)
- [The Python Tutorial – python.org](https://docs.python.org/3/tutorial/index.html)
- [Pro Git book – git-scm.com](https://www.git-scm.com/book/en/v2)
- [Computer Networks and Internet Protocol – NPTEL (IIT Kharagpur)](https://nptel.ac.in/courses/106105183)
- [Docker workshop overview – Docker Docs](https://docs.docker.com/get-started/workshop/)
- [Learn Kubernetes Basics – kubernetes.io](https://www.kubernetes.io/docs/tutorials/kubernetes-basics/)
- [AWS Cloud Practitioner training – AWS](https://aws.amazon.com/training/learn-about/cloud-practitioner/)
- [Implementing SLOs – The Site Reliability Workbook](https://sre.google/workbook/implementing-slos/)
- [Part II: Principles (Embracing Risk, Service Level Objectives) – SRE book](https://sre.google/sre-book/part-II-principles/)
- [Monitoring Distributed Systems – SRE book, Chapter 6](https://sre.google/sre-book/monitoring-distributed-systems/)
- [Monitoring – The Site Reliability Workbook](https://sre.google/workbook/monitoring/)
- [First steps with Prometheus – prometheus.io](https://prometheus.io/docs/introduction/first_steps/)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [On-Call – The Site Reliability Workbook](https://sre.google/workbook/on-call/)
- [Incident Response – The Site Reliability Workbook](https://sre.google/workbook/incident-response/)
- [Managing Incidents – SRE book](https://sre.google/sre-book/managing-incidents/)
- [Postmortem Culture: Learning from Failure – Google SRE](https://sre.google/resources/book-update/postmortem-culture/)
- [Eliminating Toil – The Site Reliability Workbook](https://sre.google/workbook/eliminating-toil/)
- [Getting started with Prometheus – prometheus.io](https://prometheus.io/docs/prometheus/latest/getting_started/)
- [Alerting overview – prometheus.io](https://prometheus.io/docs/alerting/overview)
- [Get started with Grafana and Prometheus – Grafana Docs](https://grafana.com/docs/grafana/latest/fundamentals/getting-started/first-dashboards/get-started-grafana-prometheus/)
- [Top DevOps Interview Questions – roadmap.sh](https://roadmap.sh/questions/devops)
- [System Design Interview Questions – roadmap.sh](https://roadmap.sh/questions/system-design)
- [The Site Reliability Workbook: table of contents – Google SRE](https://sre.google/workbook/table-of-contents/)

</details>

### UI/UX Designer (`ui-ux`)

Design and product · branches CSE, IT, OTHER · 10 steps, 1 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [UX Design Roadmap – roadmap.sh](https://roadmap.sh/ux-design)
- [Growing in Your UX Career: Study Guide – NN/G](https://www.nngroup.com/articles/growing-your-ux-career-study-guide/)
- [User Experience Careers (free report) – NN/G](https://media.nngroup.com/media/reports/free/UserExperienceCareers_2nd_Edition.pdf)

<details><summary>All 26 cited links</summary>

- [10 Usability Heuristics for User Interface Design – NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [User Interviews 101 – NN/G](https://www.nngroup.com/articles/user-interviews/)
- [Usability (User) Testing 101 – NN/G](https://www.nngroup.com/articles/usability-testing-101/)
- [Checklist for Moderating a Usability Test – NN/G](https://www.nngroup.com/articles/usability-checklist/)
- [Journey Mapping 101 – NN/G](https://www.nngroup.com/articles/journey-mapping-101/)
- [Wireflows 101 (video) – NN/G](https://www.nngroup.com/videos/wireflows-101/)
- [UX Mapping Methods: Study Guide – NN/G](https://www.nngroup.com/articles/ux-mapping-methods-study-guide/)
- [5 Principles of Visual Design in UX – NN/G](https://www.nngroup.com/articles/principles-visual-design/)
- [Good Visual Design, Explained – NN/G](https://www.nngroup.com/articles/good-visual-design/)
- [The Dos and Don'ts of Pairing Typefaces – NN/G](https://www.nngroup.com/articles/pairing-typefaces/)
- [Figma Design for beginners – course overview](https://help.figma.com/hc/en-us/articles/30848209492887)
- [Figma Learn: courses, tutorials and projects](https://help.figma.com/hc/en-us/categories/23557013073047-Courses-tutorials-projects)
- [What is accessibility? – MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/What_is_accessibility)
- [W3C Accessibility Standards Overview – W3C WAI](https://www.w3.org/WAI/standards-guidelines/)
- [Material Design 3 – Get started](https://m3.material.io/get-started)
- [Getting started modules – MDN Learn web development](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started)
- [Your first website – MDN](https://developer.mozilla.org/en-US/docs/learn/getting_started_with_the_web)
- [5 Steps to Creating a UX-Design Portfolio – NN/G](https://www.nngroup.com/articles/ux-design-portfolios/)
- [Creating a UX Design Portfolio Case Study (video) – NN/G](https://www.nngroup.com/videos/ux-design-portfolio-case-study/)
- [How to Maintain a UX Portfolio Over Time – NN/G](https://www.nngroup.com/articles/maintain-ux-portfolio/)
- [How to Answer UX Job Interview Questions – NN/G](https://www.nngroup.com/articles/answer-ux-job-interview-questions/)
- [UX Portfolios: Preparing for Interviews (video) – NN/G](https://www.nngroup.com/videos/ux-portfolios-interviews/)
- [UX Portfolios: What Hiring Managers Look For (video) – NN/G](https://www.nngroup.com/videos/ux-portfolios-hiring/)

</details>

### Full-Stack Web Developer (`web-fullstack`)

Software · branches CSE, IT · 10 steps, 0 marked needs review · last reviewed 2026-10-16

Roadmap sources:

- [Full Stack Developer Roadmap – roadmap.sh](https://roadmap.sh/full-stack)
- [8 In-Demand Full Stack Developer Skills – roadmap.sh](https://roadmap.sh/full-stack/developer-skills)
- [Full Stack JavaScript Path – The Odin Project](https://theodinproject.com/paths/2)
- [CS50's Web Programming with Python and JavaScript](https://cs50.harvard.edu/web/)

<details><summary>All 26 cited links</summary>

- [How the web works – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works)
- [Overview of HTTP – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [MDN Curriculum](https://developer.mozilla.org/en-US/curriculum/)
- [Learn web development – MDN](https://developer.mozilla.org/en-US/docs/Learn)
- [Pro Git (free book)](https://git-scm.com/book/en/v2)
- [The Missing Semester of Your CS Education – MIT](https://missing.csail.mit.edu/)
- [Learn Node.js – nodejs.org](https://nodejs.org/learn)
- [Hello world example – Express.js](https://expressjs.com/en/starter/hello-world/)
- [Routing – Express.js](https://expressjs.com/en/guide/routing/)
- [PostgreSQL Tutorial – PostgreSQL Documentation](https://www.postgresql.org/docs/current/tutorial.html)
- [CS50's Introduction to Databases with SQL (archived, free to view)](https://cs50.harvard.edu/sql/)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [Password Storage Cheat Sheet – OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Authentication Cheat Sheet – OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [What You Can Do to Prepare – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-what-you-can-do-to-prepare)
- [Get started – Docker Docs](https://docs.docker.com/get-started/)
- [20 Backend Project Ideas – roadmap.sh](https://roadmap.sh/backend/project-ideas)
- [Capstone – CS50's Web Programming](https://cs50.harvard.edu/web/projects/final/capstone/)
- [Strategy – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-strategy)
- [How to Become a Full Stack Developer – roadmap.sh](https://roadmap.sh/full-stack/how-to-become)
- [Preparing to Interview and Interviewing – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-preparing-to-interview-and-interviewing)
- [Applying for Web Development Jobs – The Odin Project](https://www.theodinproject.com/lessons/node-path-getting-hired-applying-for-web-development-jobs)

</details>
