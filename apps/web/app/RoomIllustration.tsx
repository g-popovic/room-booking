const palettes = [
  {
    wall: '#e0e9d9',
    floor: '#b8c8a9',
    back: '#c8d5bd',
    wood: '#ad7955',
    chair: '#526b51',
  },
  {
    wall: '#f0e4d6',
    floor: '#dac3a8',
    back: '#e6d2bc',
    wood: '#9f674c',
    chair: '#695443',
  },
  {
    wall: '#e1e6ee',
    floor: '#bfcad6',
    back: '#cfd9e4',
    wood: '#ad8168',
    chair: '#52677d',
  },
];

export function RoomIllustration({
  id,
  capacity,
}: {
  id: number;
  capacity: number;
}) {
  const tone = palettes[(id - 1) % palettes.length];
  const tableWidth = capacity <= 2 ? 105 : capacity <= 6 ? 150 : 190;
  return (
    <svg
      viewBox="0 0 400 195"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <path fill={tone.wall} d="M0 0h400v195H0z" />
      <path fill={tone.back} d="M0 0h132v114L0 156z" />
      <path fill={tone.floor} d="M0 155l132-44h268v84H0z" />
      <g stroke="#344336" strokeOpacity=".12" fill="none">
        <path d="M34 195l110-84m-35 84l61-84m14 84l16-84m60 84l-31-84m105 84l-75-84m141 43L286 111" />
        <path d="M0 169h400M54 138h346" />
      </g>
      <path fill="#fff" fillOpacity=".48" d="M155 17h110v76H155z" />
      <path
        stroke="#fff"
        strokeWidth="3"
        fill="none"
        d="M155 17h110v76H155zm55 0v76m-55-38h110"
      />
      <path fill="#fff" fillOpacity=".21" d="M169 111h91l84 73H114z" />
      <path
        fill="#f8f7ef"
        stroke={tone.wood}
        strokeWidth="3"
        d="M304 32h61v46h-61z"
      />
      <path
        fill="none"
        stroke={tone.chair}
        strokeWidth="2"
        d="M315 66l11-13 7 6 15-17"
      />
      <ellipse
        cx="218"
        cy="167"
        rx={tableWidth / 2 + 25}
        ry="16"
        fill="#34392b"
        opacity=".14"
      />
      <path stroke={tone.wood} strokeWidth="6" d="M169 137v30m97-30v30" />
      <g fill={tone.chair}>
        <rect x="177" y="101" width="32" height="26" rx="8" />
        {capacity > 2 && <rect x="228" y="101" width="32" height="26" rx="8" />}
        {capacity > 6 && <rect x="273" y="104" width="26" height="26" rx="8" />}
      </g>
      <path
        fill={tone.wood}
        d={`M${215 - tableWidth / 2} 119h${tableWidth}l15 27H${200 - tableWidth / 2}z`}
      />
      <path
        stroke="#fff"
        strokeOpacity=".26"
        d={`M${222 - tableWidth / 2} 125h${tableWidth - 14}`}
      />
      <g fill={tone.chair}>
        <rect x="186" y="145" width="34" height="29" rx="9" />
        {capacity > 2 && <rect x="237" y="145" width="34" height="29" rx="9" />}
        {capacity > 6 && <rect x="279" y="144" width="30" height="26" rx="9" />}
      </g>
      <path fill="#a56f53" d="M52 143h29l-5 24H57z" />
      <path
        fill="#527053"
        d="M66 147q-27-22-20-35 18 2 22 29-7-37 8-38 9 14-4 40 16-23 26-16-3 14-32 20z"
      />
    </svg>
  );
}
