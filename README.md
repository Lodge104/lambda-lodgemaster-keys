# lodgemaster-scrapper

## Existing pipeline stacks

Changing the `ScheduleState` default does not change the stored value on an
existing pipeline stack. To enable the schedule after deploying this update,
update the pipeline stack once and set `ScheduleState` to `ENABLED`, keeping
the current values for all other parameters.
