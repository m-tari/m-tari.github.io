---
layout: post
title: Send scheduled messages from a bot to a channel in Microsoft Teams
date: 2024-09-15 12:00:00-0400
description: Using Celery and botframework-connector to post scheduled messages to Teams channels.
tags: microsoft-teams, bots, celery, python
---

A common task I ran into while building a bot for Microsoft Teams was sending messages from the bot to a channel on a schedule. While the Python version of the [botbuilder repository](https://github.com/microsoft/BotBuilder-Samples) provides several great examples such as [Starting a new thread in a channel](https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsSDK/Archived/bot-initiate-thread-in-channel/python), I found that I needed a few extra steps to adapt those samples to my use case.

One important difference is that most examples rely on the `on_message_activity` trigger, which works well for user-driven interactions. In my case, however, I needed something that runs independently of incoming messages.

To handle scheduling, I decided to use Celery as a task scheduler. I also used the [botbuilder connector](https://github.com/Microsoft/botbuilder-python) library so I could interact with the Microsoft Teams API outside of the bot's main controller.

Here are the libraries used in this setup:

```text
botbuilder-core==4.14.6
celery==5.3.4
```

One challenge I ran into was related to authentication and message delivery. While it is possible to send messages to a channel using the Microsoft Graph API with delegated permissions, the same approach is not currently supported with application-level permissions for this scenario. Because of that, I adapted code from [botframework-connector](https://pypi.org/project/botframework-connector/) and modified it to work with Microsoft Teams channels.

```python
from botbuilder.schema import ConversationParameters, ChannelAccount
from botframework.connector import ConnectorClient
from botframework.connector.auth import MicrosoftAppCredentials
from celery import Celery

app = Celery('tasks', broker='<broker-address>')

APP_ID = '<your-app-id>'
APP_PASSWORD = '<your-app-password>'
SERVICE_URL = 'https://smba.trafficmanager.net/teams/'
CHANNEL_ID = 'msteams'
BOT_ID = '<bot-id>' # for MS Teams app, it's '28:APP_ID'
TEAMS_CHANNEL_ID = '<channel-id>'

credentials = MicrosoftAppCredentials(APP_ID, APP_PASSWORD)
connector = ConnectorClient(credentials, base_url=SERVICE_URL)

@app.task
def send_message_to_teams():
    message = MessageFactory.text("Hello World!")
    conversation = connector.conversations.create_conversation(
        ConversationParameters(
            bot=ChannelAccount(id=BOT_ID),
            channel_data={"channel": {"id": TEAMS_CHANNEL_ID}},
            activity=message,
        )
    )
```

There is also another method to send a conversation to a channel, `connector.conversations.send_to_conversation()`, which does not work currently with channels in Microsoft Teams, so instead I add the `activity` argument to `connector.conversations.create_conversation()` so that it sends the message at the same time that it creates the conversation.

To make this work, I needed the unique identifier of the target channel (`TEAMS_CHANNEL_ID`). The easiest way I found to retrieve it is by right-clicking the channel in Microsoft Teams and selecting **Get Link to channel**, then extracting the URL-encoded identifier. [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/overview?view=graph-rest-1.0) can also be used to list teams and channels:

```text
GET https://graph.microsoft.com/v1.0/teams
GET https://graph.microsoft.com/v1.0/teams/{team-id}/channels
```

Next, I configured Celery Beat to schedule the message. In my case, I wanted the bot to send a message every Monday at 7:30 a.m.:

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    'send-message-to-teams': {
        'task': 'tasks.send_message_to_teams',
        'schedule': crontab(hour=7, minute=30, day_of_week=1),
    },
}
```

Finally, I run two separate processes: one for the Celery Beat scheduler and one for the worker that executes the tasks.

To start the scheduler:

```bash
celery -A tasks beat --loglevel=INFO
```

and a Celery worker that simply executes the task on our desired time:

```bash
celery -A tasks worker --loglevel=INFO
```

Once everything is running, triggering the task manually from the application successfully posts a message to the Microsoft Teams channel. It was a small but satisfying milestone seeing the bot deliver scheduled messages without any user interaction!

{% include figure.liquid path="assets/img/2024-09-15-send-scheduled-messages-teams/teams-scheduled-message.png" class="img-fluid" zoomable=true alt="Scheduled bot message posted in a Microsoft Teams channel" %}
