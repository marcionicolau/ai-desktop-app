---
name: document-summary
version: 1.0.0
domain: notes
description: Summarize then extract action items from a transcript.
kind: pipeline
inputs:
  transcript: {type: text}
outputs:
  summary: {type: text}
  actions: {type: text}
steps:
  - id: sum
    uses: summarize-notes
    inputs: {transcript: "$params.transcript"}
  - id: act
    uses: action-items
    inputs: {transcript: "$params.transcript", summary: "sum.summary"}
---
# Document summary

Two-step pipeline: summary then action extraction.
