# Usability check at KNRCER

Prompt 3, U13. This is for the owner: you run it, with five students and one TPO at KNRCER, on their own phones. A student's session takes about 45 minutes and the TPO's about 20. Its job is to find what confuses real people, which no audit script can. The tap counts and Lighthouse numbers in [`report-3.md`](report-3.md) tell you the app is fast and short. They don't tell you it is clear.

Six tasks, taken from the seven in U0.2 (`progress-3.md` › U0 › Tap counts). The students do tasks a to e and the TPO does task f. Task g (an alumnus accepts a request from WhatsApp) needs approved WhatsApp templates and an alumnus, so it is left for the launch checks.

## Who takes part

- **Five students**, all in the final year (placement drives show to final-year students). Mix the branches.
  - At least two should prefer Telugu, and one Hindi if you can find someone.
  - At least two should use a low-end Android phone (2–3 GB of memory).
  - Nobody who has worked on CampusLink or watched a demo.
  - Everyone must be 18 or over. A minor's account needs a guardian, and the pilot keeps minors out of every list.
- **One TPO**, with a staff account that holds the college administrator or placement role.

Call them P1 to P5 and T1 on every sheet. No names go into the notes.

## Before the day

Use the live KNRCER site, after [`launch-checklist.md`](launch-checklist.md) › College set-up is done. Set up the following.

- [ ] **Not yet signed up.** The five students are on the imported list but have not signed up. Task a is their real sign-up. If one already has an account, skip task a for them and note it.
- [ ] **A drive.** One open drive that all five are eligible for, with registration open for at least another week and at most one question.
- [ ] **Two mentors.** Two alumni who offer mock interviews and have free times next week. Tell them five requests are coming and ask them to answer each one, yes or no.
- [ ] **A subject for the assistant.** One subject has the college's notes uploaded and indexed, and Admin › AI shows the AI notice accepted.
  - The pilot's allowance is 3,000 tokens per student a month, which is enough for a few questions.
  - Write the subject's name on task e's card.
- [ ] **A career path.** At least one published career path for the students' branches.
- [ ] **For the TPO's task.** Some invited members have not joined yet (the first cohort's invites give you this).
  - The college still has WhatsApp allowance for the month.
  - Tell the TPO beforehand that the nudge in task f sends real messages, and that this is fine.
- [ ] **Phones.** Participants use their own phones on their usual mobile data, not the college Wi-Fi: that is the condition that matters.
  - Before each session, write down the phone model, its memory, the Android version, the network (4G, 3G), and whether they use Chrome or the installed app.
- [ ] **Paper.** For each participant:
  - one printed card per task, in their language;
  - an observation sheet (below);
  - the single-ease question and SUS sheets;
  - a phone timer.
- [ ] **No new tools.** Don't add any screen-recording or analytics app to their phones. Notes on paper are enough.
  - If you want a screen recording, ask in writing first, keep it on your own laptop, and delete it once the notes are written.

## Consent (read it, then ask)

> Thank you for helping. We are testing CampusLink, not you: if something is hard, that is the app's fault and exactly what we want to find. I will ask you to do a few things on your own phone and to say what you are thinking as you go. I will not help while you try, but you can stop at any time, skip any task, or end the session. I will take notes without your name. Nothing is recorded unless you agree in writing. Is that all right?

Use the participant's language. A yes is enough; if you record the screen, get it in writing.

## The session (students, about 45 minutes)

1. **Welcome and consent (3 minutes).** Read the text above.
2. **About them (2 minutes).** Ask their year, branch, the language they would like to use, how they hear about drives today, and whether they have used CampusLink before.
3. **Tasks a to e (25–30 minutes), in order.** For each task:
   - **Cold start.** Ask them to close the browser or the app first, so each task starts from the phone's home screen.
   - **Read the card.** Read it aloud, then put it in front of them.
   - **Think aloud.** Ask them to say what they are looking for and why they tap what they tap. If they go quiet for long, ask once: "What are you thinking?"
   - **Don't help, don't point, don't confirm.** If they ask, say "What would you do if I weren't here?"
   - **When to stop.** Stop the task when they finish, say they would give up, or are stuck for two minutes. Then show them the way, and mark it "with help" or "not done".
   - **Ask the single-ease question** straight after the task (below).
4. **SUS questionnaire (5 minutes).**
5. **Debrief (5 minutes).**
   - What was the most confusing moment?
   - Was there a word you didn't understand?
   - Would you use this instead of what you use now, and for what?

The TPO's session is the same, with task f in place of a to e. Two more debrief questions for the TPO:

- "When you open Today, is the first item the one you would deal with first?"
- "Is anything you check every week missing from Today?"

## The tasks

The cards say what to achieve, never which button to press. Reading out a label ("tap Mentors") gives the answer away.

The shortest path is what the task audit (`e2e/audit/tasks.audit.ts`) counts on a 360 px phone, with English and the demo data: `docs/build/after-3/data-after/tasks.json`. A participant's taps beyond it are their wrong turns.

| Task                                   | Read this card                                                                                                                                        | Done when                                                                   | Shortest path (after U13)                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a. Sign up and get verified            | "Your college has invited you to CampusLink. Join it, and get to the point where the app knows you are a student here."                               | The "You’re in!" screen, and their profile shows them as verified           | 14 taps, 7 fields: the landing's join link → mobile number → Continue → name → birth month and year → Send code → the code on WhatsApp → Verify now → roll number → Find me → the code from the college's record |
| b. Ask a senior for a mock             | "Your placement interviews start next month. Ask a senior from your college to give you a practice interview."                                        | "Request sent"                                                              | 13 taps, 5 fields: Mentors → Browse → session type → a senior → Request mentorship → Mock interview → Continue → the two goal answers → Continue → a time → Send request                                         |
| c. Register for a drive                | "A company is hiring from your college this month. Sign up for its placement drive."                                                                  | The drive shows them as registered                                          | 1 tap: Register on the drive's card (Placements). A drive with questions opens its page with the form instead                                                                                                    |
| d. Follow a path, finish a step        | "Pick a career you are interested in and start working towards it in the app. Then tell the app you have finished the first thing it asks you to do." | The step shows as done                                                      | 3 taps from a followed path: Home → Next on … → Mark done. Following the path first adds a few more (Learn → the path → Start this path); the audit doesn't count those                                          |
| e. Ask the assistant, check the source | "You are studying [subject]. Ask the app a question about it, then check where its answer came from."                                                 | They opened a source under the answer, and can say which notes it came from | 5 taps, 1 field: Learn → Ask → the question → Send → a source                                                                                                                                                    |
| f. (TPO) Nudge who hasn't joined       | "Some of the students you invited haven't joined CampusLink yet. Find out who they are and remind them."                                              | The reminder is sent: a confirmation appears, and the row says it was sent  | 4 taps, 1 field: the "haven't joined yet" item on Today → Nudge → the consent choice → Send                                                                                                                      |

What to watch, per task:

- **a.**
  - Do they trust the landing page enough to start?
  - Is "mobile number" with a WhatsApp code what they expect? How long does the code take to arrive on their network?
  - Do they understand why the birth month and year are asked?
  - Do they know their roll number as the college writes it?
  - Where does the second code go, and do they find it? It goes to the email or phone on the college's record, which they may not check.
- **b.**
  - Do they find Mentors on their own?
  - How do they choose a senior: company, batch, the reason shown, the photo?
  - Is "Mock interview" clear as a choice?
  - Do they understand that the senior still has to say yes, and when?
- **c.**
  - Do they register from Home, or go looking in Placements?
  - Do they read the eligibility line and the countdown ("Closes in 2 days")?
  - Do they notice the Undo after registering, and does it worry them?
- **d.**
  - Do they understand the journey (the list of steps) and the map, and which one is next?
  - Is "Mark done" what they look for?
  - Do they expect to prove the step somehow?
- **e.**
  - Where do they look for the assistant: Learn, Study, Ask, or the search?
  - Do they read the line saying what the answer is based on?
  - Do they believe the answer more after opening the source, or less?
- **f.**
  - Does Today lead them to the people who haven't joined in one tap?
  - Do they understand the consent choice before sending?
  - Do they see the 6-second Undo?
  - Would they do this every week?

For everyone, across the tasks:

- **Language.** Does the Telugu or Hindi user stay in their language all the way? Note any English word on screen, any word they misread, and any text cut off.
- **Speed.** Note any screen that took more than about 3 seconds on their phone and network, and which screen it was. This is the real-phone check the lab can't do.
- **Missed taps.** A tap that missed its target, or hit the wrong thing.
- **Words.** Words they read aloud wrongly, or asked about.
- **Unfinished.** Anything that looked broken or unfinished to them.

## Observation sheet (one per participant)

```
Participant: P_ / T1       Date:            Phone, memory, Android:          Network:     Browser / app:
Language chosen:           Used CampusLink before? yes / no

Task  | Done (yes / with help / no) | Time (m:s) | Wrong turns (count) | Hesitations over 5 s (where) | Words not understood | Quotes | Ease (1–7)
a     |                             |            |                     |                               |                      |        |
b     |                             |            |                     |                               |                      |        |
c     |                             |            |                     |                               |                      |        |
d     |                             |            |                     |                               |                      |        |
e     |                             |            |                     |                               |                      |        |
f     |                             |            |                     |                               |                      |        |

Slow screens (over about 3 s):
Text cut off or in the wrong language:
SUS score:
Debrief answers:
```

## Single-ease question (after each task)

> Overall, how difficult or easy was this task?
>
> 1 Very difficult · 2 · 3 · 4 · 5 · 6 · 7 Very easy

Write the number in the sheet. If the answer is 4 or less, ask "What made it hard?" and note the reply word for word.

## SUS questionnaire (once, after the tasks)

The System Usability Scale (John Brooke, 1986), with "CampusLink" in place of "this system". The participant marks each statement from 1 (strongly disagree) to 5 (strongly agree). Read the statements in their language if they prefer, without changing what they mean. This is not a reviewed translation, so keep to the meaning, not the words.

1. I think that I would like to use CampusLink frequently.
2. I found CampusLink unnecessarily complex.
3. I thought CampusLink was easy to use.
4. I think that I would need the support of a technical person to be able to use CampusLink.
5. I found the various functions in CampusLink were well integrated.
6. I thought there was too much inconsistency in CampusLink.
7. I would imagine that most people would learn to use CampusLink very quickly.
8. I found CampusLink very cumbersome to use.
9. I felt very confident using CampusLink.
10. I needed to learn a lot of things before I could get going with CampusLink.

**Scoring.**

1. For odd items, subtract 1 from the answer.
2. For even items, subtract the answer from 5.
3. Add the ten results and multiply by 2.5. That gives a score from 0 to 100.

A score of 68 is about average for software. Above 80 is good. Don't average the TPO's score with the students'.

## Afterwards

1. **Fill in one summary table:**
   - per task: how many finished without help (of five), the median time, the mean ease score, and the most common wrong turn;
   - the students' mean SUS score, and T1's alone.
2. **List the problems.** Count each one by how many participants hit it. Rate it:
   - blocks the task;
   - slows it;
   - cosmetic.

   Anything that blocked two or more people goes first.

3. **Speed and language.** List the slow screens with the phone and network, and every language slip, with the screen it was on.
4. **Send the list (no names) to the next prompt** as its input. Shred the paper sheets and delete any recording once the summary is written.

The two numbers to compare against later rounds: tasks finished without help, and the students' mean SUS.
