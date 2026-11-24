/**
 * Where the camera of the view being left was looking, on the ground, in site coordinates, and which way: the Walk view drops
 * the person there. Written every frame by `ViewPoseTracker` while a view other than Walk is showing.
 */
export const viewPose = { valid: false, x: 0, y: 0, heading: 0 };
