export interface ResearchStage {
  name: string;
  title: string;
  description: string;
  example: string;
}

export const stages: readonly ResearchStage[] = [
  {
    name: "Research",
    title: "Turn capability into discovery.",
    description:
      "An existing AI system helps researchers propose ideas, write experimental code, or analyze results. Its contribution must be useful enough to improve the research process.",
    example:
      "For example: helping an engineer test a more efficient training method.",
  },
  {
    name: "Evaluate",
    title: "Separate promising ideas from progress.",
    description:
      "Researchers test proposed improvements against reliable baselines. Better benchmark scores are useful only when they reflect meaningful capability gains and survive careful checks.",
    example:
      "For example: reproducing a result and checking performance on held-out tasks.",
  },
  {
    name: "Improve",
    title: "Build the next generation.",
    description:
      "Validated discoveries can inform training methods, model architectures, or the tools used to develop AI. Producing a stronger system still requires resources, engineering, and safety evaluation.",
    example:
      "For example: applying a validated training improvement to a new model.",
  },
  {
    name: "Repeat",
    title: "Bring better tools to the next question.",
    description:
      "If the new system is more useful for AI research, it may help the next cycle. Whether progress accelerates depends on the strength of the feedback and the constraints along the way.",
    example:
      "For example: using the improved model to investigate the next research bottleneck.",
  },
];
