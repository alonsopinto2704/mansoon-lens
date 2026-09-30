# Source notes and future integration

This demo currently reads only its own generated data. The following are the intended real-data families named in the problem brief, not sources of current results:

- NCMRWF NCUM-G / NEPS for forecast rainfall; GFS/GEFS could serve as a fallback if suitable access and licenses are arranged.
- IMD 0.25° gridded daily rainfall and an IMD–NCMRWF merged product for observation; GPM IMERG could provide an independent satellite comparison.
- ERA5 reanalysis, INSAT products, and terrain and coast data for predictors.

Real data sources are not yet connected. Any integration must document provenance, permitted use, units, accumulation windows, spatial resampling, QC, and a fresh out-of-time verification campaign before performance is stated. These names are project design references, not endorsements or claims of current connectivity.
