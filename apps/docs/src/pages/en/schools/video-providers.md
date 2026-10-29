---
title: Set up a video provider
description: Connect Bunny Stream to host and stream your course videos
layout: ../../../layouts/MainLayout.astro
---

A video provider is the service that stores, processes and streams the videos of your `Video (streaming)` lessons. CourseLit currently supports Bunny Stream. Cloudflare Stream and Mux are listed as `coming soon`.

You will need an account with the provider and a video library created there before you start.

## Add a video provider

1. In the CourseLit dashboard, go to `Settings` and open the `Streaming` tab.

2. Click on `Add provider`.

3. Choose `Bunny Stream` as the provider, give it a name, and fill in the fields described below.

4. Click on `Test connection` to check that CourseLit can reach your library with the values you entered.

5. Save the provider.

## Bunny Stream values

| Field                    | What it is                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Library ID               | The ID of your Bunny Stream video library.                                                |
| CDN hostname             | The hostname that serves the videos of your library, for example `vz-xxxx-xxx.b-cdn.net`. |
| API key                  | The API key of the library. Used to create videos and read their status.                  |
| Read-only API key        | The read-only API key of the library.                                                     |
| Token authentication key | The key used to sign playback URLs so that only your learners can watch videos.           |

Where to find them in the Bunny dashboard (the form shows the same hint under each field; menus may differ slightly as Bunny updates its dashboard):

- Go to `Stream`, open your library, and open its `API` page. The `Video library ID`, the `CDN hostname`, the `API Key` and the `Read-only API Key` are shown there.
- The token authentication key is on the library's `Security` -> `General` page, at the bottom (`Token authentication key`).

Secret values (the API keys and the token authentication key) are never shown again after saving. CourseLit only shows their last 4 characters. When you edit a provider, leave a secret field empty to keep the saved value.

## Turn on token authentication in Bunny

CourseLit plays videos through signed URLs. For this to work, turn on `CDN token authentication` on the library's `Security` -> `General` page in the Bunny dashboard, and make sure the key you enter in CourseLit is the `Token authentication key` shown on that page.

If you fill in the `Allowed domains` list on the same page, it must contain the domain of your school, otherwise Bunny refuses to serve the videos to your learners' browsers.

## Add the webhook

Bunny can tell CourseLit when a video has finished processing, so that the lesson becomes ready faster.

1. In `Settings` -> `Streaming`, copy the `Webhook URL` shown on your provider.

2. In the Bunny dashboard, open your library's `API` page and paste the URL into the `Webhook URL` field.

If the webhook cannot reach your school, for example when you run CourseLit on your own computer, CourseLit still re-checks the status of videos in the background every 5 minutes, and about once a minute while the lesson editor of the video is open.

## Make a provider active

You can add more than one provider. Exactly one provider is active at a time, and it receives all new uploads. Click on `Make active` to switch. Videos that were uploaded earlier keep playing from the provider that hosts them.

## Remove a provider

`Remove` is disabled for a provider that still hosts videos. Removing a provider only removes its configuration from your school. Nothing is deleted at the provider.

## Stuck somewhere?

We are always there for you. Come chat with us in our <a href="https://discord.com/invite/GR4bQsN" target="_blank">Discord</a> channel or send a tweet at <a href="https://twitter.com/courselit" target="_blank">@CourseLit</a>.
