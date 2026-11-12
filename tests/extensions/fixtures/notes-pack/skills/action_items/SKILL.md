---
name: action_items
version: 1.0.0
domain: notes
description: Extract action items from a transcript and its summary.
runtime: prompt
inputs:
  transcript: {type: text}
  summary: {type: text}
outputs:
  actions: {type: text}
---
# Action items

## Instructions
List action items from this transcript as bullet points.

Transcript:
{inputs.transcript}

Summary:
{inputs.summary}
