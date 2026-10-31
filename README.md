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

## LodgeMaster credentials

The OA Scouting portal username/password are stored as `SecureString`
parameters in SSM Parameter Store:

- `/lodge104/lodgemaster-keys/username`
- `/lodge104/lodgemaster-keys/password`

`ScrapperFunction` reads them directly at startup (`GetParameter` with
`WithDecryption: true`), using a policy on `ScrapperRole` scoped to exactly
those two parameter ARNs plus `kms:Decrypt` restricted to
`kms:ViaService: ssm.<region>.amazonaws.com`. The credential value never
passes through a CloudFormation parameter or a Lambda environment variable
in plaintext, so it can't be read back via `DescribeStacks`,
`GetFunctionConfiguration`, or pipeline logs — only the SSM parameter *names*
are, which are not sensitive.

To rotate a credential, update the SSM parameter value directly (e.g. `aws
ssm put-parameter --name /lodge104/lodgemaster-keys/password --type
SecureString --overwrite --value <new-value>`). No redeploy is required.
Because the value is cached for the lifetime of each Lambda execution
environment, an already-warm environment keeps using the old value until it
is recycled. Since this function is invoked every 15 minutes, Lambda provides
no bounded natural recycle time, so a scheduled invocation can continue using
the old credential indefinitely. To force immediate pickup, recycle the
execution environments (for example, by publishing a no-op update to
`ScrapperFunction`); otherwise, the new value is picked up when an environment
is recycled, with no guaranteed time.

The `AlarmTopicArn`/`ErrorAlarmThreshold`/etc. parameters above are not
secrets and remain plain CloudFormation parameters.

## Monitoring & alerts

The stack defines a CloudWatch alarm, `ScrapperErrorAlarm`, that watches the
`Errors` metric (`AWS/Lambda` namespace) for the `ScrapperFunction`. By
default it fires when the function has four or more failed invocations within
a one-hour window (`ErrorAlarmThreshold` / `ErrorAlarmPeriodSeconds`), matching
the four scheduled invocations per hour. It returns to `OK` when the error
count falls below the threshold; a window with no error datapoint is treated as
healthy. Both the `ALARM` and `OK` transitions publish to the SNS topic
referenced by the `AlarmTopicArn` parameter.

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
in the console. A normal deployment can overwrite an existing alarm with the
same name, including its threshold, evaluation settings, and notification
actions. Import the alarm when you need to adopt and preserve its live
configuration rather than allowing a normal deployment to reconcile it with
the template.

The CodePipeline deploys on every push to `main`. Before merging a change that
adds this alarm, pause deployment by disabling the inbound transition to
`DeployProd`, and ensure no deployment is already in progress:

```bash
aws codepipeline disable-stage-transition \
  --pipeline-name <pipeline-name> \
  --stage-name DeployProd \
  --transition-type Inbound \
  --reason "Import the existing alarm before deployment"
```

Package the template (including its local `CodeUri` and `ContentUri` assets)
and use the packaged template for the import change set:

```bash
sam build --template-file template.yaml
sam package \
  --template-file .aws-sam/build/template.yaml \
  --s3-bucket <pipeline-artifact-bucket> \
  --region us-east-1 \
  --output-template-file packaged-prod.yaml

aws cloudformation create-change-set \
  --stack-name lodge104-lodgemaster-keys \
  --change-set-type IMPORT \
  --change-set-name import-scrapper-error-alarm \
  --template-body file://packaged-prod.yaml \
  --parameters <existing-parameter-overrides> \
  --resources-to-import '[{"ResourceType":"AWS::CloudWatch::Alarm","LogicalResourceId":"ScrapperErrorAlarm","ResourceIdentifier":{"AlarmName":"LodgeMaster API Key Refresh Lambda Function"}}]' \
  --capabilities CAPABILITY_NAMED_IAM

aws cloudformation execute-change-set \
  --stack-name lodge104-lodgemaster-keys \
  --change-set-name import-scrapper-error-alarm

aws codepipeline enable-stage-transition \
  --pipeline-name <pipeline-name> \
  --stage-name DeployProd \
  --transition-type Inbound
```

Resume deployment only after the import succeeds. Subsequent pipeline runs
manage the alarm like any other stack resource. The SNS topic itself is never
imported or deleted by this stack — it is only read via the `AlarmTopicArn`
parameter.
