"""
Generates the labelled training set for CampusCare AI (data/campus_issues.csv).

Why generated data: there is no public dataset of Indian campus complaints. This script
combines ~95 issue types (written from the categories in the project report) with campus
locations, durations, impact statements, urgency phrases, Hinglish variants and typos.
Labels follow fixed rules, so every label can be explained:

  category      from the issue type (9 classes, same ids as the backend)
  severity 1-5  base severity of the issue type; a danger statement raises it to at least 4
  urgency  1-5  base urgency; +1 each for a long duration, a statement that many students are
                affected, an exam deadline, an explicit request for urgency, or a danger statement
  safety  0-1   base safety risk of the issue type; a danger statement raises it to at least 0.8
  safety_label  1 if safety >= 0.5

Once the system is live, export real reports with training/export_backend_data.py and retrain,
so the model learns from how students actually write.

Usage:  python data/generate_dataset.py [--per-issue 45] [--seed 7] [--out data/campus_issues.csv]
"""
import argparse
import csv
import random
from pathlib import Path

# ---------------------------------------------------------------- locations
# Each location already carries its preposition so templates read naturally.
LOC = {
    "classroom": ["in Block A room 104", "in room 210 of Block B", "in LT-1", "in lecture hall 3", "in Block C room 305",
                  "in the CSE classroom on the 2nd floor", "in room 118", "in the ECE department classroom", "in tutorial room 6"],
    "lab": ["in ECE Lab 3", "in the digital electronics lab", "in the physics lab", "in CSE Lab 2", "in the microprocessor lab",
            "in the workshop", "in the chemistry lab", "in the communication systems lab", "in the VLSI lab"],
    "hostel": ["in Boys Hostel room 212", "in Girls Hostel block B", "in hostel room 31", "on the 2nd floor of the boys hostel",
               "in the girls hostel common room", "in hostel C wing", "in room 108 of the girls hostel", "in the hostel"],
    "common": ["in the main corridor of Block A", "in the 3rd floor corridor", "in the auditorium", "in the seminar hall",
               "in the admin block", "near the staff room", "in the Block B lobby", "near the stairs of Block C"],
    "outdoor": ["at the main gate", "in the parking area", "near the basketball court", "at the back gate",
                "on the campus road near the canteen", "in the garden", "near the cycle stand", "behind the Block C building"],
    "washroom": ["in the boys washroom on the 1st floor", "in the girls washroom in Block B", "in the washroom near the canteen",
                 "in the ground floor toilets", "in the hostel bathroom", "in the staff washroom", "in the 3rd floor washroom"],
    "library": ["in the Central Library", "in the library reading hall", "in the e-library section", "in the library basement"],
    "canteen": ["in the canteen", "in the mess", "in the food court", "in the canteen kitchen", "in the hostel mess"],
    "bus": ["on route 4", "on the Dwarka route", "on route 7", "on the Rohini route", "on the Janakpuri route",
            "on route 12", "on the Noida route", "on the morning trip of route 3"],
}
HINGLISH_PLACES = ["Block A", "ECE lab", "hostel", "library", "canteen", "room 210", "Block B", "girls hostel", "boys hostel", "main gate"]

# ---------------------------------------------------------------- issue types
# (category, severity, urgency, safety, location kinds, templates)
ISSUES = [
    # ---- electrical
    ("electrical", 5, 4, 0.95, ["classroom", "lab", "hostel", "common"], [
        "the switchboard {loc} is sparking", "the socket for the projector {loc} gives sparks", "the heater plug {loc} sparked", "the computer socket {loc} produced sparks", "sparks are coming out of the socket {loc}",
        "the plug point {loc} produced sparks when I plugged in my charger", "there is sparking from the switch {loc}"]),
    ("electrical", 5, 4, 0.9, ["classroom", "lab", "hostel", "common", "outdoor"], [
        "there is an exposed wire hanging {loc}", "naked electric wires are lying open {loc}",
        "a loose live wire is hanging from the ceiling {loc}", "the wiring behind the switch board {loc} is open and exposed"]),
    ("electrical", 5, 5, 1.0, ["lab", "hostel", "classroom"], [
        "I got an electric shock from the switch {loc}", "current is coming from the cooler tap {loc}", "a student got a shock while touching the cooler {loc}",
        "the metal body of the equipment {loc} gives current", "touching the iron door frame {loc} gives a shock"]),
    ("electrical", 5, 5, 1.0, ["lab", "common", "hostel", "classroom"], [
        "there is a burning smell coming from the electric panel {loc}", "smoke is coming out of the distribution board {loc}",
        "the MCB box {loc} is heating up and smells of burning plastic", "a short circuit happened {loc} and there is smoke"]),
    ("electrical", 2, 2, 0.05, ["classroom", "hostel", "lab", "library"], [
        "the ceiling fan {loc} is not working", "fan not working {loc}", "two fans {loc} do not run at all",
        "the fan {loc} does not start even after switching it on"]),
    ("electrical", 3, 2, 0.45, ["classroom", "hostel", "library"], [
        "the ceiling fan {loc} is wobbling badly and making noise", "the fan {loc} is shaking like it might fall",
        "the fan {loc} makes a loud rattling noise and is loose", "the fan blade {loc} is bent and the fan swings"]),
    ("electrical", 2, 2, 0.1, ["classroom", "lab", "library", "common"], [
        "the tube light {loc} keeps flickering", "the bulb {loc} has fused", "the bulb {loc} is not working", "lights are flickering {loc}", "the tubelight {loc} is fused",
        "half the lights {loc} are not working"]),
    ("electrical", 3, 3, 0.45, ["common", "outdoor", "hostel"], [
        "the corridor lights {loc} are off at night and it is completely dark", "street lights {loc} are not working",
        "there is no lighting {loc} after 7 pm", "the lamp posts {loc} have been dead and the area is pitch dark"]),
    ("electrical", 4, 4, 0.2, ["classroom", "lab", "hostel", "common", "library"], [
        "there is no electricity {loc}", "power cut {loc} since the morning", "the power has gone {loc} and the backup is not working",
        "no power supply {loc}"]),
    ("electrical", 2, 2, 0.0, ["classroom", "lab", "library", "common"], [
        "the AC {loc} is not cooling", "the air conditioner {loc} is not working", "the AC {loc} is leaking and not cooling",
        "the AC remote {loc} is missing and the AC stays off"]),
    ("electrical", 3, 3, 0.5, ["lab", "hostel", "classroom"], [
        "the MCB {loc} keeps tripping", "the breaker {loc} trips when too many systems are switched on", "the main switch {loc} trips every few minutes",
        "the power keeps going off {loc} because the trip switch falls", "the circuit breaker {loc} trips whenever we switch on the heater"]),
    ("electrical", 2, 2, 0.05, ["classroom", "library", "hostel", "lab"], [
        "the charging points {loc} are not working", "none of the sockets {loc} give power", "the plug points {loc} are dead",
        "there is no working socket {loc} to charge laptops"]),
    # ---- plumbing
    ("plumbing", 4, 3, 0.45, ["common", "classroom", "library", "hostel"], [
        "water is leaking from the ceiling {loc}", "a pipe is leaking {loc} and the floor is wet",
        "there is a water leakage {loc} and the floor has become slippery", "water is dripping from the roof {loc}"]),
    ("plumbing", 3, 3, 0.05, ["washroom", "hostel", "canteen"], [
        "the tap {loc} is broken and water is running continuously", "someone left the tap {loc} running", "the tap {loc} keeps running", "a tap {loc} is not closing and water is wasted",
        "the tap handle {loc} came off and water keeps flowing", "water is being wasted from a broken tap {loc}"]),
    ("plumbing", 4, 4, 0.1, ["washroom", "hostel", "canteen"], [
        "there is no water {loc}", "no water supply {loc}", "the taps {loc} are dry and there is no water at all",
        "water is not coming {loc}"]),
    ("plumbing", 2, 2, 0.0, ["common", "library", "hostel", "canteen"], [
        "the water cooler {loc} is giving warm water", "the drinking water cooler {loc} is not working",
        "the water cooler {loc} is not cooling", "the cooler {loc} is out of order"]),
    ("plumbing", 3, 3, 0.45, ["common", "canteen", "hostel", "library"], [
        "the RO water purifier {loc} is dirty and the water tastes bad", "the drinking water {loc} tastes salty", "the water filter {loc} has turned green", "drinking water {loc} smells and looks muddy",
        "the water filter {loc} has not been cleaned for months", "the drinking water {loc} is yellowish"]),
    ("plumbing", 3, 3, 0.3, ["washroom", "outdoor", "canteen"], [
        "the drain {loc} is blocked", "the basin {loc} is blocked", "the wash basin {loc} is choked", "water is logging {loc} because the drain is choked",
        "the sink {loc} is clogged and dirty water is standing", "the drainage {loc} is overflowing"]),
    ("plumbing", 3, 2, 0.05, ["washroom", "hostel"], [
        "the flush {loc} is not working", "the toilet flush {loc} is broken", "the flush tank {loc} does not fill",
        "the commode flush {loc} is not working"]),
    ("plumbing", 3, 3, 0.2, ["outdoor", "hostel", "common"], [
        "the water tank {loc} is overflowing", "the overhead tank {loc} overflows every morning",
        "water overflows from the tank {loc} and floods the area", "the tank {loc} overflows for hours"]),
    ("plumbing", 3, 2, 0.3, ["classroom", "hostel", "common", "library"], [
        "there is seepage in the wall {loc}", "the wall {loc} is damp because of seepage",
        "water seepage {loc} has made the wall wet", "there are damp patches and seepage {loc}"]),
    ("plumbing", 2, 2, 0.0, ["washroom", "hostel"], [
        "the water pressure {loc} is very low", "water comes very slowly from the taps {loc}",
        "the shower {loc} has almost no pressure", "the tap {loc} gives only a thin stream of water"]),
    # ---- sanitation
    ("sanitation", 3, 3, 0.2, ["washroom"], [
        "the washroom {loc} is very dirty", "the urinals {loc} stink", "the toilets {loc} have not been cleaned", "the washroom {loc} is filthy and stinking",
        "nobody has cleaned the toilet {loc}"]),
    ("sanitation", 3, 3, 0.2, ["outdoor", "canteen", "common", "hostel"], [
        "the garbage bins {loc} are overflowing", "garbage is piled up {loc}", "the dustbins {loc} have not been emptied",
        "trash is lying everywhere {loc}"]),
    ("sanitation", 3, 2, 0.1, ["washroom", "canteen", "common", "hostel"], [
        "there is a bad smell {loc}", "a terrible stink is coming {loc}", "it smells very bad {loc}",
        "a foul smell is spreading {loc}"]),
    ("sanitation", 3, 3, 0.5, ["outdoor", "hostel", "classroom", "canteen"], [
        "there are too many mosquitoes {loc}", "stagnant water {loc} is breeding mosquitoes",
        "mosquitoes {loc} are a dengue risk", "there is a lot of mosquito breeding {loc}"]),
    ("sanitation", 4, 3, 0.5, ["canteen", "hostel"], [
        "there are rats {loc}", "cockroaches are crawling {loc}", "I saw a rat running {loc}",
        "there are insects and cockroaches near the food {loc}"]),
    ("sanitation", 2, 3, 0.0, ["washroom"], [
        "the sanitary napkin vending machine {loc} is empty", "there is no soap {loc}", "the hand wash dispenser {loc} is empty",
        "there are no dustbins {loc}"]),
    ("sanitation", 2, 2, 0.0, ["common", "classroom", "library"], [
        "the floor {loc} has not been swept", "there is dust everywhere {loc}", "the area {loc} is not cleaned daily",
        "cobwebs and dust are all over {loc}"]),
    ("sanitation", 3, 3, 0.45, ["canteen"], [
        "the plates {loc} are not washed properly", "food is served in dirty utensils {loc}",
        "the cooking area {loc} is unhygienic", "flies are sitting on the food {loc}"]),
    ("sanitation", 4, 4, 0.4, ["outdoor", "hostel", "common"], [
        "there is a dead animal {loc} and it smells terrible", "a dead rat is lying {loc}",
        "a dead dog is lying {loc} for two days", "something died {loc} and the smell is unbearable"]),
    ("sanitation", 2, 2, 0.0, ["common", "washroom", "outdoor"], [
        "there are paan and spit stains {loc}", "people spit everywhere {loc}", "the walls {loc} are covered in stains",
        "the corners {loc} are full of gutka stains"]),
    # ---- security
    ("security", 4, 3, 0.6, ["outdoor", "common", "hostel", "library"], [
        "the CCTV camera {loc} is broken", "the CCTV {loc} is not working", "the camera {loc} is hanging loose and not recording",
        "there is no CCTV coverage {loc}"]),
    ("security", 4, 4, 0.8, ["outdoor", "hostel"], [
        "the gate lock {loc} is broken and the gate stays open at night", "the back door lock {loc} is broken and it does not shut", "the gate {loc} is left open all night",
        "anyone can walk in {loc} because the lock is broken", "the gate {loc} does not close properly"]),
    ("security", 4, 4, 0.85, ["outdoor", "hostel", "common", "library"], [
        "an outsider is roaming {loc}", "a stranger was seen {loc} late at night", "unknown people are entering {loc} without ID",
        "some outsiders were drinking {loc}"]),
    ("security", 4, 3, 0.5, ["library", "hostel", "classroom", "outdoor"], [
        "my laptop was stolen {loc}", "my laptop went missing {loc}", "my bag is missing {loc}", "my phone got stolen {loc}", "a bicycle was stolen {loc}", "things are being stolen {loc}"]),
    ("security", 5, 5, 1.0, ["outdoor", "hostel", "bus", "common"], [
        "a girl was harassed {loc}", "someone is taking photos of girls {loc}", "some boys are passing comments at girls {loc}",
        "a student is being harassed {loc}", "I was followed and harassed {loc}"]),
    ("security", 5, 5, 0.9, ["outdoor", "hostel", "canteen", "common"], [
        "there was a fight between students {loc}", "two groups were fighting {loc}",
        "students are threatening others {loc}", "a fight broke out {loc} and someone was hit"]),
    ("security", 3, 3, 0.6, ["outdoor", "hostel"], [
        "the security guard {loc} is always absent", "the guard {loc} sleeps at night",
        "there is no guard {loc} after 9 pm", "the guard post {loc} is empty"]),
    ("security", 2, 2, 0.4, ["outdoor", "library", "hostel"], [
        "ID cards are not checked {loc}", "nobody checks visitors {loc}", "there is no entry register {loc}",
        "people enter {loc} without showing ID"]),
    ("security", 5, 5, 1.0, ["hostel", "outdoor", "canteen"], [
        "seniors are ragging first years {loc}", "there is ragging happening {loc}",
        "juniors are being ragged {loc}", "a fresher was ragged {loc}"]),
    # ---- hostel
    ("hostel", 3, 3, 0.4, ["canteen", "hostel"], [
        "the mess food is stale", "we found an insect in the mess food", "the food in the mess is very bad quality",
        "the hostel mess served undercooked food"]),
    ("hostel", 2, 2, 0.1, ["hostel"], [
        "the bed {loc} is broken", "the cupboard door {loc} came off", "the cupboard {loc} is broken", "the study table {loc} is damaged",
        "the mattress {loc} is torn"]),
    ("hostel", 3, 3, 0.5, ["hostel"], [
        "the room door lock {loc} is broken", "my hostel room cannot be locked", "the latch of the door {loc} is broken",
        "the door {loc} does not lock from inside"]),
    ("hostel", 2, 2, 0.0, ["hostel"], [
        "the washing machine {loc} is not working", "the washing machines {loc} are broken", "the TV in the hostel common room is broken", "the laundry service in the hostel has stopped",
        "the laundry {loc} has not returned our clothes", "the hostel dryer is broken"]),
    ("hostel", 2, 2, 0.0, ["hostel"], [
        "the warden does not respond to complaints", "the warden office does not pick up the phone", "the warden is never available {loc}",
        "our complaints to the warden are ignored", "the hostel office does not reply"]),
    ("hostel", 3, 3, 0.1, ["hostel"], [
        "the geyser {loc} is not working", "the geyser in the hostel bathroom is broken", "there is no hot water {loc}", "the water heater {loc} is broken",
        "only cold water is coming {loc} in this winter"]),
    ("hostel", 2, 2, 0.0, ["hostel"], [
        "my room allotment is still pending", "I was given the wrong room {loc}", "the room change request is not processed",
        "hostel room allotment has not been done"]),
    ("hostel", 2, 2, 0.0, ["hostel"], [
        "students play loud music {loc} late at night", "there is too much noise {loc} at night",
        "people shout in the corridor {loc} after midnight", "neighbours make noise {loc} during study hours"]),
    ("hostel", 2, 3, 0.0, ["canteen", "hostel"], [
        "the mess closes before the dinner time given", "dinner finishes early in the mess",
        "the mess does not serve breakfast on time", "the mess ran out of food at lunch"]),
    # ---- transport
    ("transport", 2, 3, 0.0, ["bus"], [
        "the bus {loc} is late every day", "the college bus {loc} comes 30 minutes late", "the bus {loc} is always delayed",
        "the bus {loc} arrived late again"]),
    ("transport", 3, 3, 0.4, ["bus"], [
        "the bus {loc} is overcrowded", "students are standing in the doorway {loc} because it is so crowded",
        "there are not enough seats {loc}", "the bus {loc} is packed beyond capacity"]),
    ("transport", 4, 4, 0.9, ["bus"], [
        "the driver {loc} drives rashly", "the driver {loc} was overspeeding", "the bus driver {loc} was using his phone while driving",
        "the driver {loc} jumps red lights"]),
    ("transport", 3, 4, 0.3, ["bus"], [
        "the bus {loc} broke down", "the bus {loc} broke down on the way and we were stranded",
        "the bus {loc} has a flat tyre", "the bus {loc} stopped in the middle of the road"]),
    ("transport", 3, 4, 0.0, ["bus"], [
        "the bus {loc} did not come today", "the bus route was changed without any notice", "the bus {loc} skipped our stop",
        "the morning bus {loc} was cancelled without informing"]),
    ("transport", 2, 2, 0.1, ["bus"], [
        "the windows {loc} are broken", "the AC {loc} does not work", "the bus {loc} is very dirty",
        "the fan {loc} is not working"]),
    ("transport", 2, 2, 0.1, ["outdoor"], [
        "the parking {loc} is always full", "cars are parked in the wrong place {loc}", "there is no space for bikes {loc}",
        "outside vehicles are parked {loc}"]),
    ("transport", 2, 2, 0.0, ["bus"], [
        "my bus pass has not been issued", "the bus pass renewal is pending", "the transport office has not given my bus pass",
        "the bus fee receipt is not generated"]),
    ("transport", 2, 3, 0.3, ["bus"], [
        "there is no bus after 5 pm", "the evening shuttle service has stopped", "there is no transport after late labs",
        "the last bus leaves before our class ends"]),
    # ---- academic
    ("academic", 3, 3, 0.0, ["classroom"], [
        "the projector {loc} is not working", "the projector {loc} shows a blue screen", "the projector {loc} has no display",
        "the HDMI cable of the projector {loc} is missing"]),
    ("academic", 2, 3, 0.0, ["classroom"], [
        "the smart board {loc} is not working", "the smart board {loc} does not respond to touch",
        "the digital board {loc} is not turning on", "the interactive board {loc} is broken"]),
    ("academic", 3, 3, 0.1, ["lab"], [
        "the oscilloscopes {loc} are faulty", "the CROs {loc} show no waveform", "the experiments {loc} are not working", "the CRO {loc} is not working", "most of the multimeters {loc} are broken",
        "the trainer kits {loc} do not work", "the function generator {loc} is faulty", "the soldering stations {loc} are not heating"]),
    ("academic", 2, 3, 0.0, ["classroom"], [
        "there is a clash in the timetable", "two lectures are scheduled at the same time", "the timetable has not been released",
        "our lab and lecture are at the same time"]),
    ("academic", 2, 2, 0.0, ["classroom"], [
        "the teacher did not come for the lecture", "the faculty has not taken a class for two weeks",
        "classes are cancelled without notice", "no teacher came {loc} for the 3rd period"]),
    ("academic", 3, 4, 0.0, ["classroom"], [
        "there was a mistake in the question paper", "the exam hall {loc} had no invigilator",
        "the answer sheets ran out during the exam", "the exam seating plan was wrong"]),
    ("academic", 2, 2, 0.0, ["library"], [
        "the reference books are not available {loc}", "there are not enough copies of the textbook {loc}",
        "new edition books are missing {loc}", "the library does not issue books on time"]),
    ("academic", 2, 3, 0.0, ["classroom"], [
        "my attendance is not updated", "internal marks have not been uploaded", "my attendance is shown wrong",
        "the sessional marks are wrong"]),
    ("academic", 2, 3, 0.0, ["common", "classroom"], [
        "the mic {loc} is not working", "the speakers {loc} are not working", "the sound system {loc} is broken",
        "the podium mic {loc} keeps cutting off"]),
    # ---- it
    ("it", 3, 3, 0.0, ["library", "hostel", "classroom", "lab", "common"], [
        "the Wi-Fi {loc} is not working", "wifi is down {loc}", "there is no internet {loc}",
        "the wifi shows connected {loc} but nothing loads"]),
    ("it", 2, 2, 0.0, ["library", "hostel", "classroom", "lab"], [
        "the internet {loc} is very slow", "the wifi speed {loc} is very poor", "the network {loc} keeps disconnecting",
        "pages take forever to load {loc}"]),
    ("it", 3, 4, 0.0, ["classroom", "hostel", "library"], [
        "the ERP portal is not opening", "I cannot log in to the college portal", "the student portal shows a server error",
        "the online fee payment page is down"]),
    ("it", 3, 3, 0.0, ["lab"], [
        "the computers {loc} are not booting", "half the PCs {loc} do not turn on", "the systems {loc} are very slow and hang",
        "the computers {loc} show a blue screen"]),
    ("it", 2, 2, 0.0, ["library", "common", "lab"], [
        "the printer {loc} is not working", "the printer {loc} is out of toner", "the photocopier {loc} is jammed",
        "the scanner {loc} is broken"]),
    ("it", 2, 2, 0.0, ["lab", "hostel", "library"], [
        "the LAN port {loc} is dead", "the ethernet cable {loc} is broken", "the network switch {loc} is off",
        "there is no wired internet {loc}"]),
    ("it", 2, 2, 0.0, ["classroom"], [
        "I forgot my college email password and need a reset", "my college email account is blocked",
        "I cannot access my official email", "my Wi-Fi login credentials are not working"]),
    ("it", 2, 3, 0.0, ["lab"], [
        "MATLAB is not installed {loc}", "the software license {loc} has expired", "the required software is missing {loc}",
        "Python is not installed on the computers {loc}"]),
    ("it", 3, 3, 0.1, ["lab"], [
        "the computers {loc} have a virus", "the lab PCs {loc} are infected with malware",
        "pen drives get infected {loc}", "the systems {loc} show pop-up ads and viruses"]),
    # ---- infrastructure
    ("infrastructure", 5, 4, 0.9, ["classroom", "common", "hostel", "library"], [
        "the ceiling plaster {loc} is falling", "the false ceiling {loc} is hanging loose", "a piece of the ceiling fell {loc}", "plaster is coming off the roof {loc}",
        "chunks of the ceiling are falling {loc}"]),
    ("infrastructure", 4, 3, 0.7, ["classroom", "common", "hostel", "outdoor"], [
        "there is a big crack in the wall {loc}", "the stairs {loc} have cracks", "the pillar {loc} has a deep crack",
        "a large crack has appeared in the floor {loc}"]),
    ("infrastructure", 2, 2, 0.2, ["classroom", "library", "common"], [
        "the chairs {loc} are broken", "the benches {loc} are broken", "the desks {loc} are damaged",
        "several seats {loc} are broken"]),
    ("infrastructure", 3, 2, 0.3, ["classroom", "hostel", "common", "washroom"], [
        "the door {loc} is broken", "the window {loc} does not close", "the door handle {loc} came off",
        "the window frame {loc} is broken"]),
    ("infrastructure", 4, 3, 0.7, ["classroom", "common", "hostel", "library"], [
        "the window glass {loc} is broken", "broken glass pieces are lying {loc}", "a glass pane {loc} is cracked and may fall",
        "the glass door {loc} is shattered"]),
    ("infrastructure", 4, 4, 0.8, ["common", "hostel", "library"], [
        "the lift {loc} got stuck between floors", "the elevator {loc} is not working", "the lift {loc} stops suddenly and jerks",
        "the lift door {loc} does not open properly"]),
    ("infrastructure", 4, 4, 0.8, ["common", "hostel", "outdoor"], [
        "the staircase railing {loc} is broken", "the railing {loc} is loose", "the balcony railing {loc} is shaking",
        "the handrail of the stairs {loc} came off"]),
    ("infrastructure", 3, 3, 0.6, ["common", "classroom", "hostel"], [
        "the floor tiles {loc} are broken", "the steps {loc} are chipped and slippery", "loose tiles {loc} are a tripping hazard", "the floor {loc} is uneven and broken",
        "tiles {loc} have come out"]),
    ("infrastructure", 3, 2, 0.3, ["common", "outdoor", "library"], [
        "there is no ramp for wheelchair users {loc}", "the ramp {loc} is blocked", "wheelchair access {loc} is not possible",
        "the ramp {loc} is broken"]),
    ("infrastructure", 1, 1, 0.0, ["classroom", "common", "hostel"], [
        "the paint {loc} is peeling", "the walls {loc} need painting", "the notice board {loc} is broken",
        "the walls {loc} are covered with graffiti"]),
    ("infrastructure", 1, 1, 0.1, ["outdoor"], [
        "the benches {loc} are broken", "the garden swing {loc} is broken", "the seating {loc} is damaged",
        "the pathway {loc} has potholes"]),
]

# Hinglish (code-mixed) variants for common issues: (category, severity, urgency, safety, template)
HINGLISH = [
    ("electrical", 2, 2, 0.1, "{p} mein light nahi aa rahi"), ("electrical", 2, 2, 0.05, "{p} mein fan kaam nahi kar raha"),
    ("electrical", 5, 4, 0.95, "{p} mein switch board se chingari nikal rahi hai"), ("electrical", 4, 4, 0.2, "{p} mein bijli nahi hai"),
    ("plumbing", 4, 4, 0.1, "{p} mein pani nahi aa raha"), ("plumbing", 3, 3, 0.05, "{p} mein nal se pani tapak raha hai"),
    ("plumbing", 2, 2, 0.0, "{p} ke cooler ka pani garam hai"), ("plumbing", 4, 3, 0.45, "{p} mein chhat se pani tapak raha hai"),
    ("sanitation", 3, 3, 0.2, "{p} ka washroom bahut ganda hai"), ("sanitation", 3, 3, 0.2, "{p} mein kooda bahut jama ho gaya hai"),
    ("sanitation", 3, 2, 0.1, "{p} mein bahut badbu aa rahi hai"), ("sanitation", 3, 3, 0.5, "{p} mein machhar bahut hain"),
    ("security", 4, 3, 0.6, "{p} ka CCTV kharab hai"), ("security", 4, 4, 0.8, "{p} ka gate raat ko khula rehta hai"),
    ("security", 4, 4, 0.85, "{p} mein koi bahar ka aadmi ghoom raha hai"), ("security", 4, 3, 0.5, "{p} mein mera phone chori ho gaya"),
    ("hostel", 3, 3, 0.4, "mess ka khana bahut kharab hai"), ("hostel", 2, 2, 0.1, "hostel room ka bed toot gaya hai"),
    ("hostel", 3, 3, 0.1, "hostel mein geyser kaam nahi kar raha"), ("hostel", 2, 2, 0.0, "warden complaint sunte hi nahi"),
    ("transport", 2, 3, 0.0, "college bus roz late aati hai"), ("transport", 3, 3, 0.4, "bus mein bahut bheed hoti hai"),
    ("transport", 4, 4, 0.9, "bus driver bahut tez chalata hai"), ("transport", 3, 4, 0.0, "aaj bus aayi hi nahi"),
    ("academic", 3, 3, 0.0, "{p} mein projector kaam nahi kar raha"), ("academic", 3, 3, 0.1, "{p} ka CRO kharab hai"),
    ("academic", 2, 3, 0.0, "timetable mein clash hai"), ("academic", 2, 3, 0.0, "{p} ka smart board nahi chal raha"),
    ("it", 3, 3, 0.0, "{p} mein wifi nahi chal raha"), ("it", 2, 2, 0.0, "{p} mein internet bahut slow hai"),
    ("it", 3, 4, 0.0, "ERP portal khul nahi raha"), ("it", 3, 3, 0.0, "{p} ke computer start nahi ho rahe"),
    ("infrastructure", 5, 4, 0.9, "{p} mein chhat ka plaster gir raha hai"), ("infrastructure", 2, 2, 0.2, "{p} mein kursi tooti hui hai"),
    ("infrastructure", 4, 4, 0.8, "{p} ki lift beech mein atak gayi"), ("infrastructure", 4, 4, 0.8, "{p} ki lift kharab hai"), ("infrastructure", 4, 4, 0.8, "{p} ki seedhiyon ki railing tooti hai"),
]

# ---------------------------------------------------------------- modifiers
OPENERS = [""] * 6 + ["Respected sir, ", "Hello, ", "Hi, ", "Dear facilities team, ", "Sir, ", "Complaint: ", "Ma'am, ", "Please help, "]
DURATION_LONG = ["since two days", "for the last one week", "for three days now", "since last Monday", "again and again",
                 "every day", "for a month now", "since the start of the semester", "for many days"]
DURATION_SHORT = ["since morning", "since 10 am", "from today", "since yesterday evening", "today"]
IMPACT = ["Many students are affected.", "The whole class is suffering.", "Around 50 students use this daily.",
          "We are not able to study.", "Everyone on the floor is facing this.", "All of us are facing problems because of this."]
EXAM = ["Exams are starting next week.", "We have our practical exam tomorrow.", "Mid-sems are going on.",
        "Our project submission is this week."]
URGENT = ["Please fix it urgently.", "Kindly take immediate action.", "Please resolve ASAP.", "This needs attention right now.",
          "Please do something immediately."]
DANGER = ["Someone could get hurt.", "It is very dangerous.", "This is a serious safety risk.", "Students could be injured.",
          "It is not safe at all.", "A student slipped here today.", "I am scared it will fall on someone.", "Anyone could fall here.",
          "Girls feel unsafe here at night.", "It is scary to walk there at night.", "It can cause an accident.",
          "People keep slipping here."]
HEALTH = ["A few students fell sick.", "Some people got a stomach ache.", "It is a health hazard.", "People could fall ill.",
          "This can spread disease."]
HEALTH_CATEGORIES = {"sanitation", "hostel"}
CLOSERS = ["Thank you.", "Please look into it.", "Kindly do the needful.", "Please check.", "Thanks in advance.", ""]
# Neutral remarks (no label change). They stop the model from treating words like "someone" or "people"
# as danger signals just because the danger statements happen to use them.
NEUTRAL = ["Someone already complained about this last week.", "I informed the staff but nothing happened.",
           "Someone from maintenance came but did not fix it.", "We told the caretaker yesterday.",
           "People have been talking about this for a while.", "A complaint was given earlier also.",
           "Someone said it will be fixed soon but it is still the same.", "I am writing on behalf of my class."]
EXAM_CATEGORIES = {"academic", "it", "electrical", "hostel", "transport", "plumbing"}


def typo(text, rng):
    words = text.split(" ")
    idx = [i for i, w in enumerate(words) if len(w) > 4 and w.isalpha()]
    if not idx:
        return text
    i = rng.choice(idx)
    w = words[i]
    j = rng.randrange(1, len(w) - 1)
    words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:] if rng.random() < 0.5 else w[:j] + w[j + 1:]
    return " ".join(words)


def compose(category, sev, urg, safety, sentence, rng):
    """Adds modifiers to one issue sentence and returns (text, severity, urgency, safety)."""
    parts = []
    if rng.random() < 0.28:
        sentence += " " + rng.choice(DURATION_LONG)
        urg += 1
    elif rng.random() < 0.25:
        sentence += " " + rng.choice(DURATION_SHORT)
    parts.append(sentence[0].upper() + sentence[1:] + ".")
    if rng.random() < 0.18:
        parts.append(rng.choice(IMPACT)); urg += 1
    if category in EXAM_CATEGORIES and rng.random() < 0.12:
        parts.append(rng.choice(EXAM)); urg += 1
    if safety >= 0.3 and rng.random() < 0.22:
        pool = HEALTH if category in HEALTH_CATEGORIES else DANGER + HEALTH if category == "plumbing" else DANGER
        parts.append(rng.choice(pool)); sev = max(sev, 4); safety = max(safety, 0.8); urg += 1
    if rng.random() < 0.2:
        parts.append(rng.choice(URGENT)); urg += 1
    if rng.random() < 0.15:
        parts.append(rng.choice(NEUTRAL))
    if rng.random() < 0.3:
        parts.append(rng.choice(CLOSERS))
    text = rng.choice(OPENERS) + " ".join(p for p in parts if p)

    if rng.random() < 0.12:
        text = typo(text, rng)
    if rng.random() < 0.18:
        text = text.lower()
    if rng.random() < 0.1:
        text = text.replace(".", "")
    return text.strip(), min(5, sev), min(5, urg), round(min(1.0, safety), 2)


def generate(per_issue=45, seed=7):
    rng = random.Random(seed)
    rows, seen = [], set()

    def add(category, sev, urg, safety, sentence, template_id):
        text, s, u, sf = compose(category, sev, urg, safety, sentence, rng)
        if text.lower() in seen:
            return
        seen.add(text.lower())
        rows.append({"text": text, "category": category, "severity": s, "urgency": u, "safety": sf,
                     "safety_label": int(sf >= 0.5), "template_id": template_id, "source": "synthetic"})

    for i, (category, sev, urg, safety, kinds, templates) in enumerate(ISSUES):
        for _ in range(per_issue):
            t = rng.randrange(len(templates))
            loc = rng.choice(LOC[rng.choice(kinds)])
            add(category, sev, urg, safety, templates[t].format(loc=loc), f"{category}-{i:02d}-{t}")

    for i, (category, sev, urg, safety, template) in enumerate(HINGLISH):
        for _ in range(max(6, per_issue // 3)):
            add(category, sev, urg, safety, template.format(p=rng.choice(HINGLISH_PLACES)), f"{category}-hi{i:02d}")

    rng.shuffle(rows)
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--per-issue", type=int, default=45)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(Path(__file__).with_name("campus_issues.csv")))
    args = ap.parse_args()

    rows = generate(args.per_issue, args.seed)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    counts = {}
    for r in rows:
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    print(f"Wrote {len(rows)} rows to {args.out}")
    for c, n in sorted(counts.items()):
        print(f"  {c:15s} {n}")


if __name__ == "__main__":
    main()
