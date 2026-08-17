export type Mockup = {
  name: string;
  group: string;
  imageRelative: string;
  innerX?: number;
  innerY?: number;
  innerWidth: number;
  innerHeight: number;
  width: number;
  height: number;
  cornerRadius: number;
};

export const mockupsDefs = [
  {
    name: "iPhone 13",
    group: "iPhone",
    imageRelative: "/images/mockups/iphone/13/regular.png",
    innerWidth: 1170,
    innerHeight: 2532,
    width: 1314,
    height: 2658,
    cornerRadius: 160,
  },
  {
    name: "iPhone 13 Pro",
    group: "iPhone",
    imageRelative: "/images/mockups/iphone/13/pro.png",
    innerWidth: 1170,
    innerHeight: 2532,
    width: 1315,
    height: 2658,
    cornerRadius: 160,
  },
  {
    name: "iPhone 14",
    group: "iPhone",
    imageRelative: "/images/mockups/iphone/14/regular.png",
    innerWidth: 1170,
    innerHeight: 2532,
    width: 1313,
    height: 2656,
    cornerRadius: 160,
  },
  {
    name: "iPhone 14 Pro",
    group: "iPhone",
    imageRelative: "/images/mockups/iphone/14/pro.png",
    innerWidth: 1179,
    innerHeight: 2556,
    width: 1312,
    height: 2672,
    cornerRadius: 160,
  },
  {
    name: "iPhone 15",
    group: "iPhone",
    imageRelative: "/images/mockups/iphone/15/regular.png",
    innerWidth: 1179,
    innerHeight: 2556,
    width: 1316,
    height: 2674,
    cornerRadius: 160,
  },
  {
    name: "iPhone 15 Pro",
    group: "iPhone",
    imageRelative: "/images/mockups/iphone/15/pro.png",
    innerWidth: 1179,
    innerHeight: 2556,
    width: 1293,
    height: 2656,
    cornerRadius: 160,
  },
  {
    name: "Google Pixel 9 Pro",
    group: "Android",
    imageRelative: "/images/mockups/android/pixel-9-pro.png",
    innerX: 73,
    innerY: 76,
    innerWidth: 965,
    innerHeight: 2149,
    width: 1119,
    height: 2295,
    cornerRadius: 134,
  },
  {
    name: "Samsung Galaxy S25",
    group: "Android",
    imageRelative: "/images/mockups/android/galaxy-s25.png",
    innerX: 96,
    innerY: 102,
    innerWidth: 1386,
    innerHeight: 2988,
    width: 1578,
    height: 3189,
    cornerRadius: 132,
  },
  {
    name: "Android Phone",
    group: "Android",
    imageRelative: "/images/mockups/android/phone.png",
    innerX: 50,
    innerY: 55,
    innerWidth: 1108,
    innerHeight: 2418,
    width: 1236,
    height: 2584,
    cornerRadius: 125,
  },
];
