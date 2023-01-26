import prompts from "prompts";

type Station = typeof WORK_STATION | typeof HOME_STATION;

const BART_SAMPLE_KEY = "MW9S-E7SL-26DU-VV8V";
const BART_DEFAULT_SEARCH_PARAMS = {
  key: BART_SAMPLE_KEY,
  json: "y",
  a: "0",
  b: "0",
} as const;
const BART_BASE_URL = "https://api2.bart.gov/api";
const WORK_STATION = "CIVC";
const HOME_STATION = "DUBL";

const BIKE_BUFFER_TIME_MIN_DUBL = 35;
const BIKE_BUFFER_TIME_MIN_CIVC = 10;
const SHOWER_BUFFER_TIME_MIN = 15;

/**
 * Gets a date in the form of MM/DD/YYYY
 */
function getFormattedDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Gets a date in the form of "hh:mm+AM/PM"
 */
function getFormattedTime(date: Date) {
  return date
    .toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .replace(" ", "+");
}

/**
 * Gets a date representing tomorrow
 */
function getTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

/**
 * Gets a date representing today
 */
function getToday() {
  return new Date();
}

const PROMPT_QUESTIONS = [
  {
    type: "select",
    name: "dest",
    message: "Going where?",
    choices: [
      { title: "Work", value: WORK_STATION },
      { title: "Home", value: HOME_STATION },
    ],
  },
  {
    // Only used in the arrival initial value!
    type: "select",
    name: "arrivalDate",
    message: "Which day?",
    choices: [
      { title: "today", value: getToday() },
      { title: "tomorrow", value: getTomorrow() },
    ],
  },
  {
    type: "date",
    name: "arrival",
    message: "When do you need to be there?",
    mask: "HH:mm",
    initial: (_: unknown, values: Record<string, unknown>) =>
      values.arrivalDate,
    validate: (date: number) =>
      date < Date.now() ? `Date must be in the future` : true,
  },
];

/**
 * Builds in buffer so that we get the real trip length
 */
function getBufferedArrival(
  arrival: Date,
  dest: Station
): { date: Date; message: string } {
  const bufferedTime =
    dest === WORK_STATION
      ? BIKE_BUFFER_TIME_MIN_CIVC + SHOWER_BUFFER_TIME_MIN
      : BIKE_BUFFER_TIME_MIN_DUBL;
  const message =
    dest === WORK_STATION
      ? `\t${BIKE_BUFFER_TIME_MIN_CIVC} min biking from Civic Center\n\t${SHOWER_BUFFER_TIME_MIN} min shower`
      : `\t${BIKE_BUFFER_TIME_MIN_DUBL} min biking home`;
  const bufferedArrival = new Date(arrival);
  bufferedArrival.setMinutes(arrival.getMinutes() - bufferedTime);
  return { date: bufferedArrival, message };
}

/**
 * Builds in time before a departure time to get to the station on time.
 */
function getBufferedDeparture(
  departure: Date,
  dest: Station
): { date: Date; message: string } {
  const bufferedTime =
    dest === WORK_STATION
      ? BIKE_BUFFER_TIME_MIN_DUBL
      : BIKE_BUFFER_TIME_MIN_CIVC;
  const message =
    dest === WORK_STATION
      ? `\t${BIKE_BUFFER_TIME_MIN_DUBL} min biking to Dublin/Pleasanton station`
      : `\t${BIKE_BUFFER_TIME_MIN_CIVC} min biking to Civic Center station`;
  const bufferedDeparture = new Date(departure);
  bufferedDeparture.setMinutes(departure.getMinutes() - bufferedTime);
  return { date: bufferedDeparture, message };
}

/**
 * Takes input and makes a schedule URL using formatting + bart params
 */
function constructSchedUrl(arrival: Date, dest: Station): URL {
  const arrivalDate = getFormattedDate(arrival);
  const arrivalTime = getFormattedTime(arrival);
  const schedSearchParams = new URLSearchParams({
    ...BART_DEFAULT_SEARCH_PARAMS,
    cmd: "arrive",
    orig: dest === WORK_STATION ? HOME_STATION : WORK_STATION,
    dest,
    date: arrivalDate,
    time: arrivalTime,
  });
  return new URL(
    decodeURIComponent(`${BART_BASE_URL}/sched.aspx?${schedSearchParams}`)
  );
}

/**
 * Get station info https://api2.bart.gov/api/stn.aspx?cmd=stns&key=MW9S-E7SL-26DU-VV8V&json=y
 * Civic Center abbrv: CIVC
 * Dublin/Pleasanton abbrv: DUBL
 *
 * Next departure from Dublin/Pleasanton https://api2.bart.gov/api/etd.aspx?cmd=etd&orig=DUBL&key=MW9S-E7SL-26DU-VV8V&json=y
 * Gets next trip from DUBL to CIVC before 9am on 1/26/23 https://api2.bart.gov/api/sched.aspx?cmd=arrive&orig=DUBL&dest=CIVC&date=01/26/2023&time=9:00am&key=MW9S-E7SL-26DU-VV8V&a=0&b=0&json=y
 *
 * Date string as expected: new Date('01/23/2023 09:00 am')
 */

(async () => {
  const {
    dest,
    arrival,
  }: {
    dest: Station;
    arrival: Date;
  } = await prompts(PROMPT_QUESTIONS);

  const { date: bufferedArrival, message: arrivalMessage } = getBufferedArrival(
    arrival,
    dest
  );
  const schedUrl = constructSchedUrl(bufferedArrival, dest);
  const result = await fetch(schedUrl);
  const resultJson = await result.json();
  const trip = resultJson.root.schedule.request.trip;
  const departure = new Date(
    `${trip["@origTimeDate"]} ${trip["@origTimeMin"]}`
  );
  const { date: bufferedDeparture, message: departureMessage } =
    getBufferedDeparture(departure, dest);

  console.log(`\n👉 Leave by ${getFormattedTime(bufferedDeparture)}`);
  console.log(
    `(Catching the ${trip[`@origTimeMin`]} train to arrive at ${
      trip[`@destTimeMin`]
    })`
  );

  console.log();
  console.log(`That takes into account:`);
  console.log(departureMessage);
  console.log(`\t${trip[`@tripTime`]} min on the train`);
  console.log(arrivalMessage);
})();
