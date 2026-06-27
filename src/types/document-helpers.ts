// src/types/document-helpers.ts
// Re-export helpers so they can be imported from client code
// (avoids importing the full types/document.ts on the client bundle)

export {
  incrementClock,
  mergeClock,
  happenedBefore,
} from "./document";
