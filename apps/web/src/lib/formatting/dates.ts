const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not available yet';
  }

  return dateTimeFormatter.format(new Date(value));
}
