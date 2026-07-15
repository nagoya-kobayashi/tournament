(function (root) {
  "use strict";

  const standardDay1 = [
    ["09:00", [1, 2, 3, 4]],
    ["09:20", [5, 6, 7, 8]],
    ["09:40", [9, 10, 11, 12]],
    ["10:00", [13, 14, 15, 16]],
    ["10:20", [17, 18, 19, 20]],
    ["10:40", [21, 22, 23]],
    ["11:00", [24, 25, 27]],
    ["11:20", [28, 29, 30]],
    ["11:40", [31, 32, 33]],
  ];

  const standardDay2 = [
    ["09:00", [26, 34, 35, 36]],
    ["09:20", [37, 38, 39, 40]],
    ["09:40", [41, 42, 43, 44]],
    ["10:00", [45, 46]],
    ["10:20", []],
    ["10:40", []],
    ["11:00", [47, 48]],
    ["11:20", []],
    ["11:40", [49, 50]],
  ];

  const bocciaDay1 = [
    ["09:00", [1, 2, 3]],
    ["09:15", [4, 5, 6]],
    ["09:30", [7, 8, 9]],
    ["09:45", [10, 11, 12]],
    ["10:00", [13, 14, 15]],
    ["10:15", [16, 17, 18]],
    ["10:30", [19, 20, 21]],
    ["10:45", [22, 23, 24]],
    ["11:00", [25, 27, 28]],
    ["11:15", [29, 30, 31]],
    ["11:30", [32, 33]],
  ];

  const bocciaDay2 = [
    ["09:00", [26, 34, 35]],
    ["09:15", [36, 37, 38]],
    ["09:30", [39, 40, 41]],
    ["09:45", [42, 43, 44]],
    ["10:00", [45, 46]],
    ["10:15", []],
    ["10:30", [47, 48]],
    ["10:45", []],
    ["11:00", []],
    ["11:15", []],
    ["11:30", []],
    ["11:45", [49, 50]],
  ];

  root.MatchboardInitialData = {
    seedVersion: "r8-tournament-2026-06-26",
    eventTitle: "インドア選手権",
    startOffsetDays: 1,
    classes: [
      "1A", "1B", "1C", "1D", "1E", "1F", "1G", "1H",
      "2A", "2B", "2C", "2D", "2E", "2F", "2G", "2H",
      "3A", "3B", "3C", "3D", "3E", "3F", "3G", "3H", "3I",
    ],
    competitions: [
      {
        key: "othello",
        name: "オセロ",
        color: "#2f6f59",
        duration: 20,
        venues: ["生徒ホール①", "生徒ホール②", "生徒ホール③", "生徒ホール④"],
        left: ["3Ia", "3Fa", "2Ba", "1Hb", "2Ca", "1Db", "2Fb", "2Db", "1Cb", "3Hb", "1Gb", "1Ab", "2Ea", "1Ba", "2Ab", "2Hb", "3Bb", "3Eb", "3Ca", "1Fa", "3Da", "3Aa", "2Gb", "3Ga", "1Eb"],
        right: ["3Ha", "3Fb", "2Cb", "2Da", "1Ca", "2Fa", "1Da", "1Aa", "1Ga", "3Ib", "1Ha", "2Bb", "3Db", "3Ba", "3Ab", "2Ga", "3Cb", "1Bb", "3Gb", "2Aa", "3Ea", "2Ha", "2Eb", "1Fb", "1Ea"],
        days: [{ label: "1日目", rows: standardDay1 }, { label: "2日目", rows: standardDay2 }],
      },
      {
        key: "boccia",
        name: "ボッチャ",
        color: "#db754b",
        duration: 15,
        venues: ["AL教室", "e-room", "西展開教室"],
        left: ["1Cb", "3Ba", "2Ab", "1Ha", "3Ea", "3Hb", "2Da", "1Ba", "1Gb", "2Ha", "2Cb", "3Ca", "1Ab", "3Ga", "1Db", "3Ib", "3Ab", "3Fb", "2Gb", "1Eb", "1Fb", "2Ba", "3Db", "2Ea", "2Fa"],
        right: ["2Db", "1Hb", "1Ga", "3Ha", "2Aa", "3Cb", "2Ca", "3Bb", "3Eb", "1Ca", "2Hb", "1Bb", "3Gb", "1Ea", "2Fb", "3Da", "2Eb", "1Fa", "3Ia", "2Bb", "1Aa", "2Ga", "3Aa", "1Da", "3Fa"],
        days: [{ label: "1日目", rows: bocciaDay1 }, { label: "2日目", rows: bocciaDay2 }],
      },
      {
        key: "uno",
        name: "UNO",
        color: "#5379bd",
        duration: 20,
        venues: ["被服室①", "被服室②", "被服室③", "被服室④"],
        left: ["3Ab", "3Ca", "2Ca", "2Db", "1Hb", "3Ea", "3Db", "1Ca", "2Fb", "2Ga", "3Ga", "1Da", "1Fa", "3Ia", "2Bb", "3Bb", "1Bb", "2Ab", "2Eb", "1Gb", "3Ha", "1Ea", "3Fa", "2Ha", "1Ab"],
        right: ["1Cb", "2Da", "3Eb", "3Gb", "3Aa", "2Gb", "3Cb", "2Cb", "2Fa", "3Da", "1Ha", "1Db", "1Ga", "3Fb", "3Ib", "2Ea", "1Eb", "1Ba", "3Hb", "1Aa", "2Aa", "2Hb", "3Ba", "2Ba", "1Fb"],
        days: [{ label: "1日目", rows: standardDay1 }, { label: "2日目", rows: standardDay2 }],
      },
      {
        key: "connect4",
        name: "コネクト4",
        color: "#8c5caf",
        duration: 20,
        venues: ["特別講義室①", "特別講義室②", "特別講義室③", "特別講義室④"],
        left: ["1Ga", "2Ea", "3Ab", "3Fb", "1Ea", "2Bb", "1Aa", "3Ha", "1Ha", "3Gb", "2Cb", "3Ba", "2Da", "1Da", "3Ia", "2Hb", "2Fa", "2Gb", "3Ca", "2Aa", "1Cb", "1Bb", "1Fb", "3Eb", "3Da"],
        right: ["3Aa", "2Ca", "2Ba", "3Fa", "3Hb", "1Hb", "2Eb", "3Bb", "1Eb", "1Gb", "3Ga", "1Ab", "1Db", "2Fb", "2Ha", "2Ga", "3Ib", "2Ab", "2Db", "3Ea", "1Ba", "1Fa", "3Cb", "3Db", "1Ca"],
        days: [{ label: "1日目", rows: standardDay1 }, { label: "2日目", rows: standardDay2 }],
      },
    ],
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
