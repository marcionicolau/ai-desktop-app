---
name: summarize-notes
version: 1.0.0
domain: notes
description: Condense a meeting transcript into a short faithful summary.
runtime: prompt
params:
  tone: {description: "writing tone for the summary", required: false, default: neutral}
inputs:
  transcript: {type: text, constraints: {min_chars: 20}}
outputs:
  summary: {type: text}
---
# Summarize notes

## When to use
When the user wants a short summary of a transcript.

## Instructions
Write a {params.tone} summary of the meeting below, at most 120 words.

Transcript:
{inputs.transcript}

## Interpreting
The summary is plain text.

## Common mistakes
Adding facts not in the transcript.
