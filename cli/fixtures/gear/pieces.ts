// Written by scripts/make-gear.mjs: each piece's file, the joint it hangs on, and where from the joint.
export const PIECES: { name: string, joint: string, at: [number, number, number] }[] = [
    { name: "helm", joint: "head", at: [0, 0.1, 0] },
    { name: "shoulder.L", joint: "shoulder.L", at: [0.12, 0.03, 0] },
    { name: "shoulder.R", joint: "shoulder.R", at: [-0.12, 0.03, 0] },
    { name: "cloak", joint: "chest", at: [0, -0.25, -0.16] },
    { name: "sword", joint: "hand.R", at: [0, -0.05, 0] },
    { name: "shield", joint: "hand.L", at: [0.06, -0.05, 0] },
]
