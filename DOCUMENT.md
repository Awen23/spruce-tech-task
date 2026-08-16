## General Approach 

The general approach is to simulate the system hour-by-hour in order to calculate solar amounts, heating amounts, and battery storage over time; modelled depending on the external temperature, solar generated, and amount stored at that time. Those then determine the amount that's bought from the grid and at which rate, generated and used by the solar panel, and exported back to the grid. 

## Assumptions

### Assumptions on the location of the calculator within the larger system
- The client hasn't necessarily specified an interest in solar at this point; this assumption means I haven't required any additional inputs so that the integration of the calculator doesn't cost the user unless they are interested. 
- That we already have EPC data, or that we have already calculated equivalents where missing. Data assumed to be in this is: 
	- Location (although currently everything is assumed to be in London)
	- kWh of heat needed per year for heating 
	- House sizes that could give reasonable base load kWh assumptions 
- A heat pump should always be included in the calculations (but they don't already have one, so their electricty costs today don't include it)

### General assumptions: 
- I have largely assumed AI's sources to be as it reports for the sake of time, but I have got it to document its sources and its own assumptions when making guesstimates for particular values (largely in [src/calculator/constants.ts]). 
- That PVGIS is a reasonable dataset for the purpose of how much a solar panel would produce and the outside temperature for an area. 
- People or installers don't know roof orientation off the top of their head without having to think twice. 


## Tradeoffs
- Assumptions have been made in place of asking additional questions; the largest affecting one being the roof orientation. 
- In the solar + battery simulation; the battery charges from the grid if it's cheap energy, rather than waiting for solar. This (according to AI testing out the calculations) does lead to an increase in cost savings; but would effect CO2 savings if we were to add that to the system. 
- Many values are guesstimated to save time, which saves me time but will lead to inaccuracies/assumptions that could be improved in places. 
- The assumptions I have made in my modelling are different to the assumptions SAP calculations use for their annual kWh (largely entire house same temp all the time)


## Simplifications

- Everything is currently assumed to be in London when it comes to the PVGIS data; this is loaded in as a JSON to avoid making client-side API requests to their server. 
- Heat pump isn't on a smart schedule; it uses one temperature throughout the whole day. Implementing this would mean less of a gap between battery & the cheapest way you can use a heat pump; but would also need more thought into how to present this message. 
- Haven't modelled for hot water. 
- Using same heat as wanted house heat throughout the day, not taking into account that people may want a cooler temperature through the night. 
- Only accounting for heating, not thinking about the potential of heat pumps that can cool & the energy that would take. 
- One size of solar panel. 
- Just using one tariff for the costs; not averaging over tariffs, showing a comparison, etc. 
- Using an average COP value throughout the year rather than accounting for differences in efficiency throughout the year. 
- Assuming there's no limit on how much batteries can be charged/discharged throughout the day. 
- Not accounting for how charging/discharging behaviour in a battery affects long-term battery health. 
- Assumption for the energy used throughout the year is quite simple, and is a hard-coded value based on the house. 
- Assumption of one roof orientation to begin with (although editable by user)


## Improvements with more Time
- Look up actual values/benchmark values to validate the calculation results against other's results to judge accuracy. 
- APIs that give the solar orientation, rather than assuming second best. 
- Graphs to help the installer explain how the systems interact easier to the customer, e.g. 
	- A graph of solar power generated vs heat pump energy usage ("Will this cover my heat pump usage?")
	- A graph showing how the battery charges up and discharges through the day, along with how the tariff changes through the day ("Why does just a battery help?")
- Fact-check the values and assumptions made
- Add in CO2 savings 
- Account for simplifications mentioned above
