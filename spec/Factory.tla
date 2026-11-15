---------------------------- MODULE Factory ----------------------------
\* One task's life in the factory.
\* A parent Opus coordinator session picks each next step; the engine only
\* lets it take steps this spec allows. Humans act only at gates, plus
\* parking and unparking cards on the kanban board.
EXTENDS Naturals

CONSTANT Cap            \* 3: max send-backs per gate, and per automatic loop

Gates == {"ResearchGate","PlanGate","PRGate","NeedsYou"}
Parkable == {"Queued","ResearchGate","PlanGate","PRGate","NeedsYou"}
States == {"Inbox","Triage","Ignored","ReplyDrafted","Replied","Queued",
           "Researching","ResearchCheck","ResearchGate",
           "Planning","PlanGate",
           "Building","Reviewing","Confirming","PRGate",
           "NeedsYou","Parked","Done","Dropped"}
Terminal == {"Ignored","Replied","Done","Dropped"}
Loops == {"check","review","confirm"}

VARIABLES st,         \* where the task is
          tries,      \* send-backs used, per gate (never reset)
          loops,      \* automatic loops used (never reset)
          chart,      \* research produced a statechart
          proved,     \* its TLA+ model passed TLC
          findings,   \* compiled code + security review found blocking issues
          confirmed,  \* the change was run and shown to solve the problem
          approved,   \* human approvals collected so far
          parkedFrom  \* where a parked card returns to
vars == <<st, tries, loops, chart, proved, findings, confirmed, approved, parkedFrom>>
work == <<tries, loops, chart, proved, findings, confirmed, approved>>

Init == /\ st = "Inbox" /\ tries = [g \in Gates |-> 0] /\ loops = [l \in Loops |-> 0]
        /\ chart = FALSE /\ proved = FALSE /\ findings = FALSE /\ confirmed = FALSE
        /\ approved = {} /\ parkedFrom = "Queued"

Go(s) == st' = s
Same == UNCHANGED <<work, parkedFrom>>
Bump(l) == loops' = [loops EXCEPT ![l] = @ + 1]

\* ---------- intake and triage ----------
Pick      == st = "Inbox"  /\ Go("Triage") /\ Same
TIgnore   == st = "Triage" /\ Go("Ignored") /\ Same
TReply    == st = "Triage" /\ Go("ReplyDrafted") /\ Same
SendReply == st = "ReplyDrafted" /\ Go("Replied") /\ Same
\* You decide a drafted reply isn't needed after all
Dismiss   == st = "ReplyDrafted" /\ Go("Ignored") /\ Same
\* You overrule triage: an ignored item or a drafted reply becomes a task
Promote   == st \in {"Ignored","ReplyDrafted"} /\ Go("Queued") /\ Same
TTask     == st = "Triage" /\ Go("Queued") /\ Same
Start     == st = "Queued" /\ Go("Researching") /\ Same

\* ---------- research: must ship a statechart and a TLC-checked model ----------
Research   == /\ st = "Researching" /\ Go("ResearchCheck") /\ chart' = TRUE
              /\ proved' \in BOOLEAN
              /\ UNCHANGED <<tries,loops,findings,confirmed,approved,parkedFrom>>
CheckPass  == st = "ResearchCheck" /\ chart /\ proved /\ Go("ResearchGate") /\ Same
CheckRetry == /\ st = "ResearchCheck" /\ ~proved /\ loops["check"] < Cap
              /\ Go("Researching") /\ Bump("check")
              /\ UNCHANGED <<tries,chart,proved,findings,confirmed,approved,parkedFrom>>
CheckOut   == st = "ResearchCheck" /\ ~proved /\ loops["check"] = Cap /\ Go("NeedsYou") /\ Same

\* ---------- human gates: approve, send back (max Cap per gate), drop ----------
Approve(g, next, tag) ==
    /\ st = g /\ Go(next) /\ approved' = approved \cup {tag}
    /\ UNCHANGED <<tries,loops,chart,proved,findings,confirmed,parkedFrom>>
SendBack(g, back, clear) ==
    /\ st = g /\ tries[g] < Cap /\ Go(back)
    /\ tries' = [tries EXCEPT ![g] = @ + 1]
    /\ approved' = approved \ clear
    /\ IF back = "Researching" THEN chart' = FALSE /\ proved' = FALSE
                               ELSE UNCHANGED <<chart,proved>>
    /\ UNCHANGED <<loops,findings,confirmed,parkedFrom>>
Drop(g) == st = g /\ Go("Dropped") /\ Same

\* Research is reviewed in Notion (comments there); the app records one overall verdict
RGate == \/ Approve("ResearchGate","Planning","research")
         \/ SendBack("ResearchGate","Researching",{})
         \/ Drop("ResearchGate")
\* Planning splits the work into small tickets on your Notion factory board
Plan  == st = "Planning" /\ Go("PlanGate") /\ Same
PGate == \/ Approve("PlanGate","Building","plan")
         \/ SendBack("PlanGate","Planning",{})
         \/ SendBack("PlanGate","Researching",{"research"})
         \/ Drop("PlanGate")

\* ---------- build loop: no human gate until the PR is ready ----------
Build    == /\ st = "Building" /\ Go("Reviewing") /\ findings' \in BOOLEAN
            /\ confirmed' = FALSE
            /\ UNCHANGED <<tries,loops,chart,proved,approved,parkedFrom>>
Rework   == st = "Reviewing" /\ findings /\ loops["review"] < Cap /\ Go("Building")
            /\ Bump("review") /\ UNCHANGED <<tries,chart,proved,findings,confirmed,approved,parkedFrom>>
ReviewOut == st = "Reviewing" /\ findings /\ loops["review"] = Cap /\ Go("NeedsYou") /\ Same
Clean    == st = "Reviewing" /\ ~findings /\ Go("Confirming") /\ Same
\* run it and check it really solves the problem the ticket describes
Confirm  == /\ st = "Confirming" /\ confirmed' \in BOOLEAN
            /\ IF confirmed' THEN Go("PRGate")
               ELSE IF loops["confirm"] < Cap THEN Go("Building") ELSE Go("NeedsYou")
            /\ IF ~confirmed' /\ loops["confirm"] < Cap THEN Bump("confirm") ELSE UNCHANGED loops
            /\ UNCHANGED <<tries,chart,proved,findings,approved,parkedFrom>>

\* First human look at the code: a PR that is reviewed, fixed and confirmed
PRGateStep == \/ Approve("PRGate","Done","pr")
              \/ SendBack("PRGate","Building",{})
              \/ SendBack("PRGate","Planning",{"plan"})
              \/ Drop("PRGate")

\* ---------- needs you: also a gate, also capped ----------
NGate == \/ SendBack("NeedsYou","Researching",{"research","plan"})
         \/ /\ {"research","plan"} \subseteq approved
            /\ SendBack("NeedsYou","Building",{})
         \/ Drop("NeedsYou")

\* ---------- stop a running stage: it goes to Needs you, whose cap still applies ----------
Running == {"Researching","Planning","Building","Reviewing","Confirming"}
Interrupt == st \in Running /\ Go("NeedsYou") /\ Same

\* ---------- kanban: park and unpark ----------
Park   == st \in Parkable /\ Go("Parked") /\ parkedFrom' = st /\ UNCHANGED work
Unpark == st = "Parked" /\ Go(parkedFrom) /\ Same
PDrop  == Drop("Parked")

Finished == st \in Terminal /\ UNCHANGED vars

Next == \/ Pick \/ TIgnore \/ TReply \/ SendReply \/ Dismiss \/ Promote \/ TTask \/ Start
        \/ Research \/ CheckPass \/ CheckRetry \/ CheckOut
        \/ RGate \/ Plan \/ PGate
        \/ Build \/ Rework \/ ReviewOut \/ Clean \/ Confirm \/ PRGateStep
        \/ NGate \/ Interrupt \/ Park \/ Unpark \/ PDrop \/ Finished

\* Sessions eventually finish their step; people eventually act on gates
\* Steps the factory or a person must eventually take. Parking, overriding triage
\* and interrupting are your choice, so fairness never forces them. (Listed
\* positively: "Next /\ ~Interrupt" would also rule out a ReviewOut step,
\* because both move to NeedsYou with nothing else changed.)
Progress == \/ Pick \/ TIgnore \/ TReply \/ SendReply \/ TTask \/ Start
            \/ Research \/ CheckPass \/ CheckRetry \/ CheckOut
            \/ RGate \/ Plan \/ PGate
            \/ Build \/ Rework \/ ReviewOut \/ Clean \/ Confirm \/ PRGateStep
            \/ NGate \/ PDrop
Spec == Init /\ [][Next]_vars /\ WF_vars(Progress)

\* ---------- what must always hold ----------
TypeOK == /\ st \in States /\ parkedFrom \in Parkable
          /\ tries \in [Gates -> 0..Cap] /\ loops \in [Loops -> 0..Cap]
          /\ approved \subseteq {"research","plan","pr"}
\* Nothing passes the research gate without a statechart and a passing check
ResearchRule == st \in {"ResearchGate","Planning","PlanGate","Building",
                        "Reviewing","Confirming","PRGate","Done"} => chart /\ proved
\* Building only starts on approved research and an approved plan
BuildRule == st \in {"Building","Reviewing","Confirming","PRGate"}
             => {"research","plan"} \subseteq approved
\* A human sees the code only once review is clean and the fix is confirmed
PRRule == st = "PRGate" => ~findings /\ confirmed
\* Done only after research, plan and PR are all approved
GatesRule == st = "Done" => approved = {"research","plan","pr"}
\* Every task ends, or waits in Parked because you put it there
EndsOrParked == <>(st \in Terminal \cup {"Parked"})
=============================================================================
