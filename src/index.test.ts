import { Facet, GetOutput, ChangeOutput } from ".";
import { RecordTypeName, StateUpdater, StateUpdaterInput, Processor, Event } from "./processor";
import {
  BaseRecord,
  StateRecord,
  InboundRecord,
  OutboundRecord,
  newStateRecord,
  newInboundRecord,
  newOutboundRecord,
  DB,
  QueryRecordsResult,
} from "./db";

class MockDB<TState, TInputEvents, TOutputEvents>
  implements DB<TState, TInputEvents, TOutputEvents>
{
  constructor() {
    this.getState = jest.fn();
    this.putState = jest.fn();
    this.queryRecords = jest.fn();
    this.queryRecordsBySecondaryIndex = jest.fn();
    this.queryRecordsByRangePrefix = jest.fn();
    this.queryRecordsBySecondaryIndexAndRangePrefix = jest.fn();
  }

  getState(id: string): Promise<StateRecord<TState>> {
    throw new Error("Method not implemented.");
  }
  putState(
    state: StateRecord<TState>,
    previousSeq: number,
    inbound: (BaseRecord & TInputEvents)[],
    outbound: (BaseRecord & TOutputEvents)[],
    secondaryIndexRecords: StateRecord<TState>[],
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }
  queryRecords(id: string): Promise<QueryRecordsResult<TState, TInputEvents, TOutputEvents>[]> {
    throw new Error("Method not implemented.");
  }
  queryRecordsBySecondaryIndex(
    byIndex: string,
    id: string,
  ): Promise<QueryRecordsResult<TState, TInputEvents, TOutputEvents>[]> {
    throw new Error("Method not implemented.");
  }
  queryRecordsByRangePrefix(
    rng: string,
    id: string,
  ): Promise<QueryRecordsResult<TState, TInputEvents, TOutputEvents>[]> {
    throw new Error("Method not implemented.");
  }
  queryRecordsBySecondaryIndexAndRangePrefix(
    rng: string,
    byIndex: string,
    id: string,
  ): Promise<QueryRecordsResult<TState, TInputEvents, TOutputEvents>[]> {
    throw new Error("Method not implemented.");
  }
}

interface TestItem {
  a: string;
  b: string;
}

interface TestEvent {
  data1: string;
  data2: string;
}

const getDefaultMockDB = () => new MockDB<TestItem, TestEvent, TestEvent>();

describe("facet", () => {
  describe("get", () => {
    it("returns null when the db returns null", async () => {
      const db = getDefaultMockDB();
      const emptyRules = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      const processor = new Processor<TestItem, TestEvent, TestEvent>(emptyRules);
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);

      const state = await facet.get("abc");

      expect(state).toBeNull();
    });
    it("returns the item when the db returns a record", async () => {
      const expectedState: TestItem = { a: "a", b: "b" };
      const expectedRecord: BaseRecord = {
        _id: "id",
        _rng: "rng",
        _facet: "facet",
        _typ: "typ",
        _ts: 0,
        _date: "date",
        _seq: 0,
      };

      const expected: GetOutput<TestItem> = {
        record: expectedRecord,
        item: expectedState,
      };
      const db = getDefaultMockDB();
      (db.getState as jest.Mock).mockResolvedValue({
        ...expectedRecord,
        ...expectedState,
      });
      const emptyRules = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      const processor = new Processor<TestItem, TestEvent, TestEvent>(emptyRules);
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);

      const getOutput = await facet.get("abc");

      expect(getOutput).toEqual(expected);
    });
  });
  describe("append", () => {
    it("stores new events in the database", async () => {
      interface EventForTest {
        name: string;
      }

      const event1 = {
        name: "event1",
      };
      const event21 = {
        name: "event2.1",
      };
      const event22 = {
        name: "event2.2",
      };
      const initial: TestItem = { a: "0", b: "empty" };
      const db = getDefaultMockDB();
      (db.putState as jest.Mock).mockImplementation(async (state, _previousSeq, _data, events) => {
        expect(state).toEqual(JSON.stringify(initial));
        expect(events.length).toBe(3);
        expect(events[0]._typ).toEqual("eventName1");
        expect(events[0]._itm).toBe(JSON.stringify(event1));
        expect(events[1]._typ).toEqual("eventName2.1");
        expect(events[1]._itm).toBe(JSON.stringify(event21));
        expect(events[2]._typ).toEqual("eventName2.2");
        expect(events[2]._itm).toBe(JSON.stringify(event22));
      });

      // Create the rules.
      const publishEvent = new Map<
        RecordTypeName,
        StateUpdater<TestItem, EventForTest, EventForTest, EventForTest>
      >();
      publishEvent.set("Record1", (input) => {
        input.publish("eventName1", event1);
        return input.state;
      });
      publishEvent.set("Record2", (input) => {
        input.publish("eventName2.1", event21);
        input.publish("eventName2.2", event22);
        return input.state;
      });
    });
    it("uses defaults if no state record exists", async () => {
      const initial: TestItem = { a: "0", b: "empty" };
      const db = getDefaultMockDB();
      // Don't return any records.
      (db.queryRecords as jest.Mock).mockResolvedValue([]);

      // Create empty rules.
      const publishEvent = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      const processor = new Processor<TestItem, any, any>(publishEvent, () => initial);

      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      facet.appendTo = async (id, state, seq): Promise<ChangeOutput<TestItem, TestEvent>> => {
        expect(id).toEqual("id");
        expect(state).toBe(null);
        expect(seq).toEqual(0);
        return {
          seq: 0,
          item: {},
        } as ChangeOutput<TestItem, TestEvent>;
      };
      await facet.append("id");
    });
    it("uses the state record if it exists", async () => {
      const initial: TestItem = { a: "0", b: "empty" };
      const db = getDefaultMockDB();
      const expectedState: TestItem = { a: "expected", b: "value" };
      // Return a state record.
      (db.getState as jest.Mock).mockImplementation(
        async (id: string): Promise<BaseRecord> =>
          newStateRecord("name", id, 1, expectedState, new Date()),
      );

      // Create empty rules.
      const publishEvent = new Map<RecordTypeName, StateUpdater<TestItem, any, any, any>>();
      const processor = new Processor<TestItem, TestEvent, TestEvent>(publishEvent, () => initial);

      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      facet.appendTo = async (id, state, seq): Promise<ChangeOutput<TestItem, TestEvent>> => {
        expect(id).toEqual("id");
        expect(state).toEqual(expectedState);
        expect(seq).toEqual(1);
        return {
          seq: 1,
          item: {},
        } as ChangeOutput<TestItem, TestEvent>;
      };
      await facet.append("id");
    });
  });
  describe("recalculate", () => {
    it("creates an empty state record on first put if it doesn't exist", async () => {
      const db = getDefaultMockDB();
      const emptyRules = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      const processor = new Processor<TestItem, TestEvent, TestEvent>(emptyRules);
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      const event: TestEvent = { data1: "1", data2: "2" };

      const putOutput = await facet.recalculate("id", new Event<TestEvent>("TestEvent", event));

      expect(putOutput.item).toEqual({});
      expect(putOutput.newOutboundEvents).toHaveLength(0);
      expect(putOutput.seq).toBe(1);
    });
    it("creates an initial state record on first put if it doesn't exist", async () => {
      const db = getDefaultMockDB();
      const initial: TestItem = { a: "empty", b: "empty" };
      const emptyRules = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      const processor = new Processor<TestItem, TestEvent, TestEvent>(emptyRules, () => initial);
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      const event: TestEvent = { data1: "1", data2: "2" };

      const putOutput = await facet.recalculate("id", new Event<TestEvent>("TestEvent", event));

      expect(putOutput.item).toEqual(initial);
      expect(putOutput.newOutboundEvents).toHaveLength(0);
      expect(putOutput.seq).toBe(1);
    });
    it("uses the state updater to calculate the state record state based on initial events", async () => {
      const db = getDefaultMockDB();
      const initial: TestItem = { a: "0", b: "empty" };
      const concatenateEventValuesToHead = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      concatenateEventValuesToHead.set(
        "TestEvent",
        (input: StateUpdaterInput<TestItem, TestEvent, TestEvent, TestEvent>): TestItem => {
          input.state.a = `${input.state.a}_${input.current.data1}`;
          return input.state;
        },
      );
      const processor = new Processor<TestItem, TestEvent, TestEvent>(
        concatenateEventValuesToHead,
        () => initial,
      );
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      const e1: TestEvent = { data1: "1", data2: "" };
      const e2: TestEvent = { data1: "2", data2: "" };

      const putOutput = await facet.recalculate(
        "id",
        new Event<TestEvent>("TestEvent", e1),
        new Event<TestEvent>("TestEvent", e2),
      );

      const expected: TestItem = { a: "0_1_2", b: "empty" };

      expect(putOutput.item).toEqual(expected);
      expect(putOutput.newOutboundEvents).toHaveLength(0);
      expect(putOutput.seq).toBe(2);
    });
    it("uses the state updater to re-calculate the state record state based on new events", async () => {
      const db = getDefaultMockDB();
      const initial: TestItem = { a: "0", b: "empty" };

      // Create the rules.
      const concatenateEventValuesToHead = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      concatenateEventValuesToHead.set(
        "TestEvent",
        (input: StateUpdaterInput<TestItem, TestEvent, TestEvent, TestEvent>): TestItem => {
          input.state.a = `${input.state.a}_${input.current.data1}`;
          return input.state;
        },
      );
      const processor = new Processor<TestItem, TestEvent, TestEvent>(
        concatenateEventValuesToHead,
        () => initial,
      );
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      // Configure the database to already have e1 and e2 present.
      const now = new Date();
      const currentHead: TestItem = { a: "0_1_2", b: "empty" };
      const e1: TestEvent = { data1: "1", data2: "" };
      const e2: TestEvent = { data1: "2", data2: "" };
      const e3: TestEvent = { data1: "3", data2: "" };
      (db.queryRecords as jest.Mock).mockImplementation(
        async (_id: string): Promise<Array<BaseRecord>> =>
          new Array<BaseRecord>(
            newStateRecord<TestItem>("TestItem", "id", 3, currentHead, now),
            newInboundRecord<TestEvent>("TestItem", "id", 1, "TestEvent", e1, now),
            newInboundRecord<TestEvent>("TestItem", "id", 2, "TestEvent", e2, now),
          ),
      );

      const expected: TestItem = { a: "0_1_2_3", b: "empty" };
      const putOutput = await facet.recalculate("id", new Event<TestEvent>("TestEvent", e3));

      expect(putOutput.item).toEqual(expected);
      expect(putOutput.newOutboundEvents).toHaveLength(0);
      expect(putOutput.seq).toBe(4);
    });
    it("ignores unkown record types in the calculation", async () => {
      const db = getDefaultMockDB();
      const initial: TestItem = { a: "0", b: "empty" };

      // Create the rules.
      const concatenateEventValuesToHead = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      concatenateEventValuesToHead.set(
        "TestEvent",
        (input: StateUpdaterInput<TestItem, TestEvent, TestEvent, TestEvent>): TestItem => {
          input.state.a = `${input.state.a}_${input.current.data1}`;
          return input.state;
        },
      );
      const processor = new Processor<TestItem, TestEvent, TestEvent>(
        concatenateEventValuesToHead,
        () => initial,
      );
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      // Configure the database to already have e1 and e2 present.
      const now = new Date();
      const currentHead: TestItem = { a: "0_1_2", b: "empty" };
      const e1: TestEvent = { data1: "1", data2: "" };
      const e2: TestEvent = { data1: "2", data2: "" };
      const e3: TestEvent = { data1: "3", data2: "" };
      (db.queryRecords as jest.Mock).mockImplementation(
        async (_id: string): Promise<Array<BaseRecord>> =>
          new Array<BaseRecord>(
            newStateRecord<TestItem>("TestItem", "id", 3, currentHead, now),
            newInboundRecord<TestEvent>("TestItem", "id", 1, "TestEvent", e1, now),
            newInboundRecord<TestEvent>("TestItem", "id", 2, "TestEvent", e2, now),
            {
              _id: "unknown id",
              _seq: 4,
              _rng: "unknown range",
            } as BaseRecord,
          ),
      );

      const expected: TestItem = { a: "0_1_2_3", b: "empty" };
      const putOutput = await facet.recalculate("id", new Event<TestEvent>("TestEvent", e3));

      expect(putOutput.item).toEqual(expected);
      expect(putOutput.newOutboundEvents).toHaveLength(0);
      expect(putOutput.seq).toBe(4);
    });
    it("returns a list of historical and new events", async () => {
      const initial: TestItem = { a: "0", b: "empty" };
      interface TestOutputEvent {
        payload: TestEvent;
      }
      const db = new MockDB<TestItem, TestEvent, TestOutputEvent>();

      // Create the rules.
      const rules = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestOutputEvent, TestEvent>
      >();
      rules.set(
        "TestEvent",
        (input: StateUpdaterInput<TestItem, TestEvent, TestOutputEvent, TestEvent>): TestItem => {
          input.publish("eventName", { payload: input.current });
          return input.state;
        },
      );
      const processor = new Processor<TestItem, TestEvent, TestOutputEvent>(rules, () => initial);
      const facet = new Facet<TestItem, TestEvent, TestOutputEvent>("name", db, processor);
      // Configure the database to already have data1 and data2 present.
      const now = new Date();
      const currentHead: TestItem = { a: "0_1_2", b: "empty" };
      const e1: TestEvent = { data1: "1", data2: "" };
      const e2: TestEvent = { data1: "2", data2: "" };
      const e3: TestEvent = { data1: "3", data2: "" };
      // These events are in the database, but the rules don't cover them.
      // This means that they get ignored.
      const event1 = { eventName: "event1" };
      const event2 = { eventName: "event2" };
      (db.queryRecords as jest.Mock).mockImplementation(
        async (_id: string): Promise<Array<BaseRecord>> =>
          new Array<BaseRecord>(
            newInboundRecord<TestEvent>("TestItem", "id", 1, "TestEvent", e1, now),
            newInboundRecord<TestEvent>("TestItem", "id", 2, "TestEvent", e2, now),
            newOutboundRecord("TestItem", "id", 3, 0, "OldEvent", event1, now),
            newOutboundRecord("TestItem", "id", 4, 1, "OldEvent", event2, now),
            newStateRecord<TestItem>("TestItem", "id", 5, currentHead, now),
          ),
      );

      const putOutput = await facet.recalculate("id", new Event<TestEvent>("TestEvent", e3));

      // We get two old events (one raised by e1, one raised by e2).
      expect(putOutput.pastOutboundEvents).toHaveLength(2);
      expect(putOutput.pastOutboundEvents[0]).toEqual({
        type: "eventName",
        event: { payload: e1 },
      });
      expect(putOutput.pastOutboundEvents[1]).toEqual({
        type: "eventName",
        event: { payload: e2 },
      });
      // We get a new event too, raised by the new e3.
      expect(putOutput.newOutboundEvents).toHaveLength(1);
      expect(putOutput.newOutboundEvents[0]).toEqual({ type: "eventName", event: { payload: e3 } });
    });
    it("sorts data after it's returned by the database", async () => {
      const db = getDefaultMockDB();
      const initial: TestItem = { a: "0", b: "empty" };

      // Create the rules.
      const rules = new Map<
        RecordTypeName,
        StateUpdater<TestItem, TestEvent, TestEvent, TestEvent>
      >();
      const received = new Array<string>();
      rules.set(
        "TestEvent",
        (input: StateUpdaterInput<TestItem, TestEvent, TestEvent, TestEvent>): TestItem => {
          received.push(input.current.data1);
          return input.state;
        },
      );
      const processor = new Processor<TestItem, TestEvent, TestEvent>(rules, () => initial);
      const facet = new Facet<TestItem, TestEvent, TestEvent>("name", db, processor);
      // Configure the database to already have data1 and data2 present.
      const now = new Date();
      const data1: TestEvent = { data1: "1", data2: "" };
      const data2: TestEvent = { data1: "2", data2: "" };
      const data3: TestEvent = { data1: "3", data2: "" };
      const data4: TestEvent = { data1: "4", data2: "" };

      // Return data incorrectly sorted.
      (db.queryRecords as jest.Mock).mockImplementation(
        async (_id: string): Promise<Array<BaseRecord>> =>
          new Array<BaseRecord>(
            newInboundRecord<TestEvent>("TestItem", "id", 2, "TestEvent", data2, now),
            newInboundRecord<TestEvent>("TestItem", "id", 1, "TestEvent", data1, now),
            newInboundRecord<TestEvent>("TestItem", "id", 3, "TestEvent", data3, now),
            newInboundRecord<TestEvent>("TestItem", "id", 3, "TestEvent", data4, now),
          ),
      );

      const putOutput = await facet.recalculate("id");

      expect(putOutput.item).toEqual(initial);
      expect(received).toEqual(["1", "2", "3", "4"]);
    });
  });
});
