# lodgemaster-scrapper

Scrapes LodgeMaster session cookies via Puppeteer and stores them in
DynamoDB. Deployed with AWS SAM (`template.yaml`) and a CodePipeline
(`codepipeline.yaml`) that builds, packages, and deploys the stack to the
`prod` region on every push to `main`.

## Existing pipeline stacks

Changing the `ScheduleState` default does not change the stored value on an
existing pipeline stack. To enable the schedule after deploying this update,
update the pipeline stack once and set `ScheduleState` to `ENABLED`, keeping
the current values for all other parameters.

## Monitoring & alerts

The stack defines a CloudWatch alarm, `ScrapperErrorAlarm`, that watches the
`Errors` metric (`AWS/Lambda` namespace) for the `ScrapperFunction`. By
default it fires when the function logs 12 or more errors within a one-hour
window (`ErrorAlarmThreshold` / `ErrorAlarmPeriodSeconds`), and clears when
the function reports no errors in a later window. Both the `ALARM` and `OK`
transitions publish to the SNS topic referenced by the `AlarmTopicArn`
parameter.

That topic — `lodge104-lambda` — is **shared** across other Lodge 104 Lambda
functions (not just this one) and already has email, SMS, and Slack
subscribers. For that reason, the topic itself is **not** defined/owned by
this stack; it's only referenced by ARN. Managing subscriptions (adding or
removing recipients) is done directly on the topic outside of this repo, so
that other stacks publishing to the same topic are unaffected.

To point at a different notification topic (e.g. for a non-prod stack),
override the `AlarmTopicArn` parameter at deploy time.

### One-time import for existing resources

Both the CloudWatch alarm (`LodgeMaster API Key Refresh Lambda Function`) and
the SNS topic it publishes to pre-date this stack and were created directly
in the console. The alarm is now defined in `template.yaml`, but since it
already exists outside of CloudFormation, a plain `sam deploy` on a stack
that has never seen it will try to **create** a new alarm with that name.
`AWS::CloudWatch::Alarm` creation silently overwrites an existing alarm of
the same name rather than failing outright, which still leaves the alarm
untracked by the stack (and liable to be deleted if that create ever rolls
back). To adopt the live alarm safely, import it into the stack once instead
of deploying normally:

```bash
aws cloudformation create-change-set \
  --stack-name lodge104-lodgemaster-keys \
  --change-set-type IMPORT \
  --change-set-name import-scrapper-error-alarm \
  --template-body file://template.yaml \
  --parameters <existing-parameter-overrides> \
  --resources-to-import '[{"ResourceType":"AWS::CloudWatch::Alarm","LogicalResourceId":"ScrapperErrorAlarm","ResourceIdentifier":{"AlarmName":"LodgeMaster API Key Refresh Lambda Function"}}]' \
  --capabilities CAPABILITY_NAMED_IAM

aws cloudformation execute-change-set \
  --stack-name lodge104-lodgemaster-keys \
  --change-set-name import-scrapper-error-alarm
```

After the import completes, subsequent `sam deploy`/pipeline runs manage the
alarm like any other stack resource. The SNS topic itself is never imported
or deleted by this stack — it is only read via the `AlarmTopicArn` parameter.
