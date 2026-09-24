// Landmark registry: each file default-exports an array of landmark definitions.
import hamerschlag from "./hamerschlag.js";
import bakerPorter from "./bakerPorter.js";
import cfa from "./cfa.js";
import mmch from "./mmch.js";
import hunt from "./hunt.js";
import gates from "./gates.js";
import cohon from "./cohon.js";
import tepper from "./tepper.js";
import fence from "./fence.js";
import walkingToTheSky from "./walkingToTheSky.js";
import scotty from "./scotty.js";
import stadium from "./stadium.js";
import mellonInstitute from "./mellonInstitute.js";
import cathedralOfLearning from "./cathedralOfLearning.js";
import phipps from "./phipps.js";
import carnegieMuseum from "./carnegieMuseum.js";
import wean from "./wean.js";
import forbesWest from "./forbesWest.js";
import craig from "./craig.js";
import warner from "./warner.js";
import kenmawr from "./kenmawr.js";
import pennAve from "./pennAve.js";

export const LANDMARKS = [hamerschlag, bakerPorter, cfa, mmch, hunt, gates, cohon, tepper, fence, walkingToTheSky, scotty, stadium, mellonInstitute, cathedralOfLearning, phipps, carnegieMuseum, wean, forbesWest, craig, warner, kenmawr, pennAve].flat().filter(Boolean);
