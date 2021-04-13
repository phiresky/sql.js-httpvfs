import React from "react";
import { render } from "react-dom";
import { UI } from "./UI";import{configure} from "mobx";

configure({
    enforceActions: "never",
})

render(<UI />, document.getElementById("root"));
