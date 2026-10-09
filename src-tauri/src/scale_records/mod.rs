//! Scale records: the persistence, effect computation, and report rendering
//! behind the emotion-regulation evaluation loop. One file per responsibility
//! — `model` (types + frozen constants), `schema`, `queries` (CRUD + row
//! mapping), `effect` (baseline/post summary), `history` (chronological run
//! pairing), `comparison` (cross-condition comparison), and `report`
//! (single/batch/comparison document + CSV renderers).

mod comparison;
mod effect;
mod history;
mod model;
mod queries;
mod report;
mod schema;

#[cfg(test)]
mod tests;

pub use comparison::*;
pub use effect::*;
pub use history::*;
pub use model::*;
pub use queries::*;
pub use report::*;
pub use schema::*;
