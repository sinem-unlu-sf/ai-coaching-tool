Product Requirements Document (PRD)
Project: Voice-Based AI Coach for Career & Academic Goals

Version: v1.0
Owner: Sinem
Stage: College Freshman Project / Product Prototype
Deployment Target: Vercel
Core AI Stack: Gemini API + ElevenLabs

1. Product Overview
1.1 Problem Statement

Many students and early-career individuals struggle to clearly define career or academic goals, break them into actionable steps, and reflect productively on their progress. Traditional coaching is expensive and inaccessible, while generic AI chatbots lack intentional coaching structure.

1.2 Solution

A minimal, voice-first AI coach that conducts a live, turn-based coaching conversation. The coach adapts its behavior based on user-selected personality traits and guides the user toward:

Goal clarity

Direction

Concrete next actions

The experience prioritizes depth of thinking over features.

2. Target Users
Primary Users

College students

Early-career professionals

Individuals seeking career or academic clarity

User Needs

A space to think out loud

Reflective questioning, not just answers

Actionable outcomes

Low friction (no accounts, no setup overhead)

3. Non-Goals (Explicitly Out of Scope for V1)

User accounts or authentication

Long-term memory across sessions

Data persistence or analytics

Mental health therapy or diagnosis

Text-based chat UI

Mobile app (web only)

4. Core User Experience
4.1 Session Flow

User opens the app

User selects up to 3 personality traits

User starts a session

Voice-based, push-to-talk conversation begins

AI coach guides the conversation

User may request a written summary at any time

AI ends the session with a closing synthesis

Session data is discarded

4.2 Interaction Model

Turn-based voice conversation

Push-to-talk button

Near-real-time response (2–3s latency target)

Clear visual states:

Listening

Thinking

Speaking

5. Personality System
5.1 Trait Selection

User selects up to 3 traits

Traits are chosen once per session

Traits cannot be changed mid-session

5.2 Trait Design Philosophy

Traits are behavioral constraints, not aesthetic labels.

Each trait maps to:

Tone

Question vs advice ratio

Structure level

Framework usage permission

Pacing

5.3 Trait Categories (15–20 Total)

Tone & Emotional Style

Empathetic

Encouraging

Calm

Challenging

Cognitive Style

Reflective

Analytical

Big-picture

Tactical

Structure & Direction

Structured

Exploratory

Goal-driven

Action-oriented

Intervention Style

Directive

Question-led

Framework-based

Intuition-based

Traits are composable. Conflicts are resolved deliberately by the AI.

6. Coaching Logic & Intelligence
6.1 Coaching Principles (System Rules)

The AI coach must:

Reflect before advising

Avoid overwhelming the user

Limit action steps to 2–4

Ask clarifying questions until the goal is clear

Gently redirect off-topic discussion back to goals

Maintain a moderately flexible scope (career/academic focus)

6.2 Internal Goal-Tracking Checklist

The AI internally tracks:

Is the goal clearly stated?

Is the motivation understood?

Are constraints acknowledged?

Are next steps defined?

This checklist guides turn-by-turn behavior but is never shown to the user.

6.3 Framework Usage

Frameworks (e.g., SMART goals) are only introduced if allowed by selected traits

Frameworks are optional, never forced

Language remains conversational, not academic

7. Session Ending Behavior
7.1 Ending Conditions

The session ends when:

Goal clarity is achieved

Direction is established

Action steps are defined

7.2 Mandatory Closing Response

The final AI response must:

Explicitly signal closure (“Before we wrap up…”)

Summarize the user’s goal

List 2–4 concrete next steps

Offer a written summary

Invite the user to start a new session

8. Summary Feature
8.1 User-Initiated Summary

User can request a written summary at any point

Summary includes:

Clarified goal

Key insights

Action steps

8.2 End-of-Session Summary

Automatically offered at the end

Displayed on a final screen

Not stored after session ends

9. Frontend Requirements
9.1 Tech

Next.js (App Router)

Single-page app with internal view states

Deployed on Vercel

9.2 Screens
Screen 1: Session Setup

App title

Short description

Trait selection (chips/pills)

Start Session button

Screen 2: Coaching Session

Large push-to-talk button

Status text (Listening / Thinking / Speaking)

Minimal visuals only

Screen 3: Session End

Written summary

Action steps

Start New Session button

10. Backend Architecture
10.1 Deployment

Vercel Serverless Functions

10.2 Session State

Ephemeral session object

Session ID generated on start

Stored only in memory

Destroyed at session end

10.3 API Endpoints (Conceptual)

POST /session/start

Input: selected traits

Output: session ID

POST /session/turn

Input: audio blob + session ID

Process:

Gemini STT

Prompt construction

Gemini LLM

ElevenLabs TTS

Output: audio response + metadata

POST /session/end

Optional explicit cleanup

Final summary generation if needed

11. AI & Voice Stack
11.1 AI

Gemini API for:

Speech-to-text

LLM reasoning

11.2 Voice

ElevenLabs for text-to-speech

1–2 predefined coach voices

12. Latency Targets

STT: < 1s

LLM: 1–2s

TTS: < 1s

Total turn latency: ~2–3 seconds

13. Privacy & Ethics
13.1 Data Handling

No data persistence

No logging of transcripts

No user identity

13.2 Safety Boundaries

Not a therapist or professional advisor

Gentle redirection for emotional distress

Clear disclosure: coaching and reflection tool only

14. Execution Plan (Testable Chunks)
Chunk 1: Minimal Frontend Shell

Trait selection UI

Push-to-talk button

State indicators

Chunk 2: Session Lifecycle

Start session

End session

State cleanup

Chunk 3: Voice Pipeline

Audio capture

Gemini STT

ElevenLabs playback

Chunk 4: Coaching Prompt System

System rules

Personality injection

Goal-tracking logic

Chunk 5: Summary Generation

On-demand summary

End-of-session synthesis

Each chunk is independently testable.

15. Success Criteria (V1)

Conversation feels coherent and coach-like

User leaves with clear next steps

System is stable and deploys cleanly on Vercel

Scope remains controlled