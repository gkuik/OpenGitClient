/*
  Tranches de temps de l'historique, comme GitKraken : un séparateur et une
  étiquette (« 3 hours ago », « yesterday ») sur le premier commit de chaque
  tranche.

  Les tranches s'élargissent avec l'âge — heures, jours, semaines, mois,
  années — pour qu'un historique ancien ne soit pas haché d'un séparateur par
  jour travaillé. Jamais plus fines que l'heure : toute la dernière heure est
  une seule tranche (« this hour »), sans séparateur entre ses commits. Pur et testé ; le libellé lui-même vient de
  `Intl.RelativeTimeFormat`, qui connaît la langue et ses formes (« hier »,
  « la semaine dernière ») sans rien ajouter au catalogue.
*/

export type BucketUnit = "hour" | "day" | "week" | "month" | "year";

export interface TimeBucket {
  unit: BucketUnit;
  /** Âge dans cette unité, arrondi vers le bas : 0 heure = « cette heure-ci ». */
  n: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Mois et année moyens : une tranche n'a pas besoin du calendrier exact. */
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

/**
 * Tranche d'un commit daté `ts` (secondes Unix), vue depuis `now`. Une date
 * dans le futur — horloge décalée d'un collègue — compte dans la dernière heure.
 */
export function bucketOf(ts: number, now: number): TimeBucket {
  const age = Math.max(0, now - ts);
  if (age < DAY) return { unit: "hour", n: Math.floor(age / HOUR) };
  if (age < WEEK) return { unit: "day", n: Math.floor(age / DAY) };
  // Jusqu'à cinq semaines : « 4 weeks ago » se lit mieux que « last month ».
  if (age < 5 * WEEK) return { unit: "week", n: Math.floor(age / WEEK) };
  if (age < YEAR) return { unit: "month", n: Math.max(1, Math.floor(age / MONTH)) };
  return { unit: "year", n: Math.floor(age / YEAR) };
}

export function sameBucket(a: TimeBucket, b: TimeBucket): boolean {
  return a.unit === b.unit && a.n === b.n;
}

/**
 * Pour chaque date, dans l'ordre : la tranche si elle ouvre une nouvelle
 * tranche, `null` sinon. La première date ouvre toujours la sienne.
 *
 * On compare à la date **précédente**, pas au début de la tranche : l'ordre
 * topologique n'est pas strictement chronologique, et un commit plus ancien
 * glissé entre deux récents rouvre simplement la tranche d'après — c'est ce que
 * fait GitKraken, et c'est ce qui dit la vérité sur la rangée.
 */
export function bucketStarts(timestamps: number[], now: number): (TimeBucket | null)[] {
  let previous: TimeBucket | null = null;
  return timestamps.map((ts) => {
    const bucket = bucketOf(ts, now);
    const starts = previous === null || !sameBucket(previous, bucket);
    previous = bucket;
    return starts ? bucket : null;
  });
}

/** Libellé d'une tranche dans la langue donnée : « 3 hours ago », « yesterday ». */
export function bucketLabel(bucket: TimeBucket, fmt: Intl.RelativeTimeFormat): string {
  return fmt.format(-bucket.n, bucket.unit);
}
